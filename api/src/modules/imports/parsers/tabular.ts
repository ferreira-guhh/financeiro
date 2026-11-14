/**
 * CSV e Excel: ambos viram uma matriz de células e passam pelo mesmo mapeador de colunas.
 * Detecta automaticamente cabeçalhos comuns de bancos brasileiros (Nubank, Itaú, Inter, BB...).
 */
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { normalizeDescription } from '../../../lib/fingerprint.js';
import {
  cleanDescription,
  decodeText,
  parseAmount,
  parseDate,
  type DateFormat,
  type ParseResult,
} from './normalize.js';

export interface TabularOptions {
  delimiter?: string;
  decimalSeparator?: ',' | '.';
  dateFormat?: DateFormat;
  /** Inverte o sinal (faturas de cartão costumam listar compras como positivas). */
  invertSign?: boolean;
  /** Nome do cabeçalho ou índice (0-based) de cada coluna. */
  columns?: {
    date?: string | number;
    description?: string | number;
    amount?: string | number;
    debit?: string | number;
    credit?: string | number;
    fitId?: string | number;
  };
  sheet?: string;
}

type Cell = string | number | Date | null | undefined;

const ALIASES: Record<'date' | 'description' | 'amount' | 'debit' | 'credit' | 'fitId', string[]> = {
  date: ['DATA', 'DATE', 'DT', 'DATA LANCAMENTO', 'DATA DO LANCAMENTO', 'DATA MOVIMENTO', 'DATA DE LANCAMENTO', 'DATA TRANSACAO'],
  description: ['DESCRICAO', 'DESCRIPTION', 'HISTORICO', 'LANCAMENTO', 'TITLE', 'MEMO', 'ESTABELECIMENTO', 'DETALHES', 'NOME', 'TITULO'],
  amount: ['VALOR', 'AMOUNT', 'VALUE', 'VALOR (R$)', 'VALOR R$', 'VALOR EM R$', 'QUANTIA'],
  debit: ['DEBITO', 'SAIDA', 'SAIDAS', 'DEBIT', 'VALOR DEBITO'],
  credit: ['CREDITO', 'ENTRADA', 'ENTRADAS', 'CREDIT', 'VALOR CREDITO'],
  fitId: ['IDENTIFICADOR', 'ID', 'ID TRANSACAO', 'DOCUMENTO', 'NR DOCUMENTO', 'FITID'],
};

function findHeaderRow(matrix: Cell[][]): number {
  for (let i = 0; i < Math.min(matrix.length, 20); i++) {
    const cells = matrix[i]!.map((c) => normalizeDescription(String(c ?? '')));
    const hasDate = cells.some((c) => ALIASES.date.includes(c));
    const hasValue = cells.some((c) => ALIASES.amount.includes(c) || ALIASES.debit.includes(c) || ALIASES.credit.includes(c));
    if (hasDate && hasValue) return i;
  }
  return -1;
}

function resolveColumn(headers: string[], spec: string | number | undefined, key: keyof typeof ALIASES): number {
  if (typeof spec === 'number') return spec;
  if (typeof spec === 'string') return headers.indexOf(normalizeDescription(spec));
  return headers.findIndex((h) => ALIASES[key].includes(h));
}

export function parseMatrix(matrix: Cell[][], options: TabularOptions = {}): ParseResult {
  const warnings: string[] = [];
  const nonEmpty = matrix.filter((r) => r.some((c) => c !== null && c !== undefined && String(c).trim() !== ''));
  const headerIndex = findHeaderRow(nonEmpty);
  const hasExplicitColumns = options.columns && Object.values(options.columns).some((v) => typeof v === 'number');
  if (headerIndex < 0 && !hasExplicitColumns) {
    throw new Error('Não encontrei as colunas de data e valor. Informe o mapeamento em options.columns.');
  }
  const headers = headerIndex >= 0 ? nonEmpty[headerIndex]!.map((c) => normalizeDescription(String(c ?? ''))) : [];
  const col = {
    date: resolveColumn(headers, options.columns?.date, 'date'),
    description: resolveColumn(headers, options.columns?.description, 'description'),
    amount: resolveColumn(headers, options.columns?.amount, 'amount'),
    debit: resolveColumn(headers, options.columns?.debit, 'debit'),
    credit: resolveColumn(headers, options.columns?.credit, 'credit'),
    fitId: resolveColumn(headers, options.columns?.fitId, 'fitId'),
  };
  if (col.date < 0) throw new Error('Coluna de data não encontrada');
  if (col.amount < 0 && col.debit < 0 && col.credit < 0) throw new Error('Coluna de valor não encontrada');

  const rows: ParseResult['rows'] = [];
  nonEmpty.slice(headerIndex + 1).forEach((r, i) => {
    const line = headerIndex + i + 2;
    const date = parseDate(r[col.date], options.dateFormat);
    let amount: string | null = null;
    if (col.amount >= 0 && r[col.amount] !== null && r[col.amount] !== undefined && String(r[col.amount]).trim() !== '') {
      amount = parseAmount(r[col.amount] as string | number, options.decimalSeparator);
    } else {
      const debit = col.debit >= 0 ? parseAmount(r[col.debit] as string | number, options.decimalSeparator) : null;
      const credit = col.credit >= 0 ? parseAmount(r[col.credit] as string | number, options.decimalSeparator) : null;
      if (debit && debit !== '0.00') amount = debit.startsWith('-') ? debit : `-${debit}`;
      else if (credit && credit !== '0.00') amount = credit.replace(/^-/, '');
    }
    if (!date) {
      // Linhas de saldo/rodapé costumam não ter data válida: ignora sem alarde se também não houver valor.
      if (amount) warnings.push(`Linha ${line}: data inválida — ignorada`);
      return;
    }
    if (!amount || amount === '0.00') {
      warnings.push(`Linha ${line}: valor inválido ou zero — ignorada`);
      return;
    }
    if (options.invertSign) amount = amount.startsWith('-') ? amount.slice(1) : `-${amount}`;
    const description = cleanDescription(col.description >= 0 ? r[col.description] : '') || 'Sem descrição';
    const fitIdRaw = col.fitId >= 0 ? String(r[col.fitId] ?? '').trim() : '';
    rows.push({ date, amount, description, ...(fitIdRaw && { fitId: fitIdRaw.slice(0, 255) }) });
  });
  return { rows, warnings };
}

/**
 * Detecta o separador ignorando o conteúdo entre aspas. Necessário porque, em extratos
 * brasileiros, a vírgula decimal ("1.234,56") confunde a autodetecção genérica.
 */
export function guessDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20).map((l) => l.replace(/"[^"]*"/g, '""'));
  let best = ',';
  let bestScore = -1;
  for (const candidate of [';', '\t', ',', '|']) {
    const counts = lines.map((l) => l.split(candidate).length - 1).filter((c) => c > 0);
    if (counts.length === 0) continue;
    const freq = new Map<number, number>();
    for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1);
    const score = Math.max(...freq.values());
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

export function parseCsv(buffer: Buffer, options: TabularOptions = {}): ParseResult {
  const text = decodeText(buffer);
  const parsed = Papa.parse<string[]>(text, {
    delimiter: options.delimiter ?? guessDelimiter(text),
    skipEmptyLines: 'greedy',
  });
  if (parsed.data.length === 0) throw new Error('CSV vazio');
  return parseMatrix(parsed.data, options);
}

export async function parseXlsx(buffer: Buffer, options: TabularOptions = {}): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = options.sheet ? workbook.getWorksheet(options.sheet) : workbook.worksheets[0];
  if (!sheet) throw new Error(options.sheet ? `Aba "${options.sheet}" não encontrada` : 'Planilha sem abas');

  const matrix: Cell[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = (row.values as ExcelJS.CellValue[]).slice(1); // índice 0 é vazio no exceljs
    matrix.push(values.map(cellToPrimitive));
  });
  return parseMatrix(matrix, options);
}

function cellToPrimitive(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'boolean') return String(v);
  if ('result' in v) return cellToPrimitive(v.result as ExcelJS.CellValue); // fórmula
  if ('richText' in v) return v.richText.map((t) => t.text).join('');
  if ('text' in v) return String(v.text);
  return String(v);
}
