/**
 * Motor de parcelamento — funções puras em centavos.
 */
import { addMonths, parseDate, type ISODate } from './dates.js';

/**
 * Divide o total em N parcelas. A diferença de centavos fica na 1ª parcela
 * (prática dos cartões): R$ 100,00 em 3x → 33,34 + 33,33 + 33,33.
 */
export function splitInstallments(totalCents: bigint, count: number): bigint[] {
  if (count < 1 || !Number.isInteger(count)) throw new Error('Quantidade de parcelas inválida');
  if (totalCents <= 0n) throw new Error('Total deve ser positivo');
  const n = BigInt(count);
  const base = totalCents / n;
  if (base === 0n) throw new Error('Valor da parcela seria menor que R$ 0,01');
  const remainder = totalCents - base * n;
  return Array.from({ length: count }, (_, i) => (i === 0 ? base + remainder : base));
}

export interface ScheduledInstallment {
  number: number;
  amountCents: bigint;
  /** Data de competência da parcela: mesma data da compra, k−1 meses depois. */
  date: ISODate;
}

export function buildInstallmentSchedule(
  purchaseDate: ISODate,
  amounts: bigint[],
): ScheduledInstallment[] {
  const anchorDay = parseDate(purchaseDate)[2];
  return amounts.map((amountCents, i) => ({
    number: i + 1,
    amountCents,
    date: addMonths(purchaseDate, i, anchorDay),
  }));
}
