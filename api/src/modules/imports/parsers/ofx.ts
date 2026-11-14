/**
 * Parser OFX tolerante: OFX 1.x (SGML, tags sem fechamento) e 2.x (XML).
 * Lê extratos de conta (BANKMSGSRSV1) e de cartão (CREDITCARDMSGSRSV1) — ambos usam STMTTRN.
 */
import { cleanDescription, decodeText, parseAmount, parseDate, type ParseResult } from './normalize.js';

function tagValue(block: string, tag: string): string | undefined {
  // <TAG>valor  (até a próxima tag ou quebra de linha), com ou sem </TAG>.
  const match = block.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i'));
  const value = match?.[1]?.trim();
  return value ? decodeEntities(value) : undefined;
}

function decodeEntities(s: string) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

export function parseOfx(buffer: Buffer): ParseResult {
  // O cabeçalho (ASCII) informa o charset do restante do arquivo.
  const head = buffer.subarray(0, 600).toString('latin1');
  const charset = head.match(/CHARSET:\s*([\w-]+)/i)?.[1] ?? head.match(/encoding="([\w-]+)"/i)?.[1];
  const text = decodeText(buffer, charset && charset !== 'NONE' ? charset : undefined);

  if (!/<OFX>/i.test(text)) throw new Error('Arquivo não parece ser um OFX válido (tag <OFX> ausente)');

  const warnings: string[] = [];
  const rows: ParseResult['rows'] = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1).map((b) => b.split(/<\/STMTTRN>/i)[0]!);

  blocks.forEach((block, i) => {
    const date = parseDate(tagValue(block, 'DTPOSTED') ?? '', 'YYYY-MM-DD');
    // Alguns bancos brasileiros usam vírgula decimal no TRNAMT.
    const rawAmount = tagValue(block, 'TRNAMT') ?? '';
    const amount = parseAmount(rawAmount, rawAmount.includes(',') && !rawAmount.includes('.') ? ',' : '.');
    const memo = tagValue(block, 'MEMO');
    const name = tagValue(block, 'NAME');
    const description = cleanDescription(memo && name && !memo.includes(name) ? `${name} ${memo}` : (memo ?? name ?? ''));
    const fitId = tagValue(block, 'FITID');

    if (!date || !amount) {
      warnings.push(`Transação ${i + 1}: data ou valor inválido — ignorada`);
      return;
    }
    if (amount === '0.00') {
      warnings.push(`Transação ${i + 1}: valor zero — ignorada`);
      return;
    }
    rows.push({ date, amount, description: description || 'Sem descrição', ...(fitId && { fitId }) });
  });

  if (blocks.length === 0) warnings.push('Nenhuma transação (STMTTRN) encontrada no arquivo');
  return { rows, warnings };
}
