import { createHash } from 'node:crypto';
import { normalizeMoney } from './money.js';

/**
 * Normaliza descrições bancárias para comparação determinística:
 * remove acentos, MAIÚSCULAS, colapsa espaços.
 * "  Pagamento   iFood  São Paulo " → "PAGAMENTO IFOOD SAO PAULO"
 */
export function normalizeDescription(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export interface FingerprintInput {
  accountId: string;
  /** YYYY-MM-DD */
  date: string;
  /** Valor ASSINADO (saída negativa) — receita e despesa de mesmo valor não colidem. */
  amount: string;
  rawDescription: string;
  /**
   * 0 para a primeira ocorrência. Usado apenas quando o usuário confirma que
   * duas transações idênticas são legítimas (ex.: dois cafés iguais no mesmo dia).
   */
  occurrence?: number;
}

/** SHA-256 hex de `account_id|date|amount|DESCRICAO_NORMALIZADA[|#n]`. */
export function computeFingerprint(input: FingerprintInput): string {
  const parts = [
    input.accountId.toLowerCase(),
    input.date,
    normalizeMoney(input.amount),
    normalizeDescription(input.rawDescription),
  ];
  if (input.occurrence && input.occurrence > 0) parts.push(`#${input.occurrence}`);

  return createHash('sha256').update(parts.join('|'), 'utf8').digest('hex');
}
