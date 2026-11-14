/**
 * Formato normalizado de transação — o contrato comum entre TODAS as fontes:
 * CSV, OFX, Excel e, no futuro, provedores de Open Finance (BankSyncProvider).
 */
import { isValidDate } from '../../../domain/dates.js';
import { fromCents, MAX_ABS_CENTS } from '../../../lib/money.js';

export interface NormalizedTransaction {
  /** YYYY-MM-DD */
  date: string;
  /** Assinado: entrada > 0, saída < 0. String decimal "−123.45". */
  amount: string;
  description: string;
  /** Identificador único da transação na origem (FITID do OFX, id do provedor). */
  fitId?: string;
}

export interface ParseResult {
  rows: NormalizedTransaction[];
  warnings: string[];
}

/**
 * Converte valores no formato brasileiro ou internacional em string decimal assinada.
 * Aceita: "1.234,56", "-45,90", "1,234.56", "R$ 45,90", "(45,90)", "45,90 D", "45,90-".
 */
export function parseAmount(raw: unknown, decimalSeparator?: ',' | '.'): string | null {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    // Excel guarda números como double; arredonda para centavos de forma segura.
    return fromCents(BigInt(Math.round(raw * 100)));
  }
  if (typeof raw !== 'string') return null;
  let s = raw.trim().toUpperCase();
  if (!s) return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/\s*D$/.test(s) && !/C$/.test(s)) {
    negative = true;
    s = s.replace(/\s*D$/, '');
  } else s = s.replace(/\s*C$/, '');
  if (s.endsWith('-')) {
    negative = true;
    s = s.slice(0, -1);
  }
  s = s.replace(/R\$|BRL|\s/g, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) s = s.slice(1);

  const sep = decimalSeparator ?? guessDecimalSeparator(s);
  const thousands = sep === ',' ? '.' : ',';
  s = s.split(thousands).join('');
  if (sep === ',') s = s.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;

  const [int, frac = ''] = s.split('.');
  if (frac.length > 2 && !/^0+$/.test(frac.slice(2))) return null; // centavos fracionados = formato ambíguo
  const cents = BigInt(int!) * 100n + BigInt(frac.slice(0, 2).padEnd(2, '0'));
  if (cents > MAX_ABS_CENTS) return null;
  return fromCents(negative ? -cents : cents);
}

function guessDecimalSeparator(s: string): ',' | '.' {
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) return lastComma > lastDot ? ',' : '.';
  if (lastComma >= 0) return ',';
  // Só ponto: "1.234" (3 dígitos após um ponto, em grupo) é milhar; "12.50" é decimal.
  if (lastDot >= 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) return ',';
  return '.';
}

export type DateFormat = 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';

/** Datas: "15/11/2026", "15/11/26", "2026-11-15", "20261115", Date, serial do Excel. */
export function parseDate(raw: unknown, format: DateFormat = 'DD/MM/YYYY'): string | null {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const iso = raw.toISOString().slice(0, 10);
    return isValidDate(iso) ? iso : null;
  }
  if (typeof raw === 'number' && raw > 20000 && raw < 80000) {
    // Serial do Excel (dias desde 1899-12-30).
    const ms = Date.UTC(1899, 11, 30) + Math.round(raw) * 86_400_000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  if (typeof raw !== 'string') return null;
  const s = raw.trim().slice(0, 10).trim();

  let y: string | undefined;
  let m: string | undefined;
  let d: string | undefined;
  let match: RegExpMatchArray | null;
  if ((match = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) [, y, m, d] = match;
  else if ((match = raw.trim().match(/^(\d{4})(\d{2})(\d{2})/))) [, y, m, d] = match;
  else if ((match = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/))) {
    const [, a, b, yy] = match;
    [d, m] = format === 'MM/DD/YYYY' ? [b, a] : [a, b];
    y = yy!.length === 2 ? `20${yy}` : yy;
  } else return null;

  const iso = `${y}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
  return isValidDate(iso) ? iso : null;
}

export function cleanDescription(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 255);
}

/** Decodifica texto de extrato: UTF-8 se válido, senão Windows-1252 (comum em bancos BR). */
export function decodeText(buffer: Buffer, hint?: string): string {
  const wants1252 = hint && /1252|latin|8859|ansi/i.test(hint);
  if (!wants1252) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '');
    } catch {
      // cai para 1252
    }
  }
  return new TextDecoder('windows-1252').decode(buffer);
}
