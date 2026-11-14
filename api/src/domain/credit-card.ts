/**
 * Ciclo de faturas do cartão — funções puras.
 *
 * Convenções (as mesmas dos bancos brasileiros):
 * - A fatura é identificada pelo mês do VENCIMENTO ("fatura de dezembro" vence em dezembro).
 * - Fechamento no mês M = dia `closingDay` (limitado ao fim do mês).
 * - Compra ANTES do fechamento entra na fatura que fecha naquele mês;
 *   compra NO dia do fechamento ou depois vai para a próxima ("melhor dia de compra").
 * - Se dueDay > closingDay, vence no mesmo mês do fechamento; senão, no mês seguinte.
 */
import { addMonthsToKey, clampedDate, monthKey, parseDate, parseMonth, type ISODate, type MonthKey } from './dates.js';

export interface CardCycle {
  closingDay: number;
  dueDay: number;
}

export interface InvoicePeriod {
  year: number;
  month: number;
  /** YYYY-MM do vencimento — chave da fatura. */
  key: MonthKey;
  closingDate: ISODate;
  dueDate: ISODate;
}

const dueInSameMonth = (cycle: CardCycle) => cycle.dueDay > cycle.closingDay;

/** Período da fatura a partir do mês de vencimento. */
export function periodFromDueMonth(dueKey: MonthKey, cycle: CardCycle): InvoicePeriod {
  const [dy, dm] = parseMonth(dueKey);
  const closingKey = dueInSameMonth(cycle) ? dueKey : addMonthsToKey(dueKey, -1);
  const [cy, cm] = parseMonth(closingKey);
  return {
    year: dy,
    month: dm,
    key: dueKey,
    closingDate: clampedDate(cy, cm, cycle.closingDay),
    dueDate: clampedDate(dy, dm, cycle.dueDay),
  };
}

/** Fatura em que uma compra feita em `date` cai. */
export function invoicePeriodForDate(date: ISODate, cycle: CardCycle): InvoicePeriod {
  const [y, m] = parseDate(date);
  const closingThisMonth = clampedDate(y, m, cycle.closingDay);
  const closingKey = date < closingThisMonth ? monthKey(date) : addMonthsToKey(monthKey(date), 1);
  const dueKey = dueInSameMonth(cycle) ? closingKey : addMonthsToKey(closingKey, 1);
  return periodFromDueMonth(dueKey, cycle);
}

/** k faturas depois (k pode ser negativo). */
export function shiftPeriod(period: InvoicePeriod, k: number, cycle: CardCycle): InvoicePeriod {
  return periodFromDueMonth(addMonthsToKey(period.key, k), cycle);
}

export type InvoiceStatus = 'open' | 'closed' | 'paid' | 'overdue';

/** Status sempre derivado — nunca armazenado. Valores em centavos. */
export function invoiceStatus(params: {
  today: ISODate;
  closingDate: ISODate;
  dueDate: ISODate;
  totalCents: bigint;
  paidCents: bigint;
}): InvoiceStatus {
  const { today, closingDate, dueDate, totalCents, paidCents } = params;
  if (today < closingDate) return 'open';
  if (paidCents >= totalCents) return 'paid';
  if (today > dueDate) return 'overdue';
  return 'closed';
}
