/**
 * Motor de recorrência — gera as datas de ocorrência de um modelo (aluguel, salário...).
 * Puro e determinístico: a mesma regra sempre produz as mesmas datas.
 */
import {
  addDays,
  clampedDate,
  diffDays,
  maxDate,
  minDate,
  monthKey,
  monthsBetween,
  parseDate,
  type ISODate,
} from './dates.js';

export type Frequency = 'weekly' | 'monthly' | 'yearly';

export interface RecurrenceRule {
  frequency: Frequency;
  interval: number;
  /** Obrigatório para monthly/yearly (31 = último dia em meses curtos). */
  dayOfMonth: number | null;
  startDate: ISODate;
  endDate: ISODate | null;
}

/** Datas de ocorrência dentro de [from, to] (inclusivo). */
export function occurrencesBetween(rule: RecurrenceRule, from: ISODate, to: ISODate): ISODate[] {
  const lower = maxDate(from, rule.startDate);
  const upper = rule.endDate ? minDate(to, rule.endDate) : to;
  if (lower > upper) return [];

  const result: ISODate[] = [];
  const interval = Math.max(1, rule.interval);

  if (rule.frequency === 'weekly') {
    const step = 7 * interval;
    const offset = Math.max(0, Math.ceil(diffDays(rule.startDate, lower) / step));
    for (let d = addDays(rule.startDate, offset * step); d <= upper; d = addDays(d, step)) {
      if (d >= lower) result.push(d);
    }
    return result;
  }

  const [sy, sm] = parseDate(rule.startDate);
  const day = rule.dayOfMonth ?? parseDate(rule.startDate)[2];
  const stepMonths = rule.frequency === 'monthly' ? interval : 12 * interval;
  // Pula direto para perto de `lower` em vez de iterar desde o início.
  const elapsed = Math.max(0, monthsBetween(monthKey(rule.startDate), monthKey(lower)));
  let k = Math.max(0, Math.floor(elapsed / stepMonths) - 1);

  for (;;) {
    const d = clampedDate(sy, sm + k * stepMonths, day);
    if (d > upper) break;
    if (d >= lower) result.push(d);
    k++;
  }
  return result;
}

/** Próxima ocorrência a partir de `from` (inclusivo), ou null se a regra terminou. */
export function nextOccurrence(rule: RecurrenceRule, from: ISODate): ISODate | null {
  const horizon = addDays(from, 366 * rule.interval + 31);
  return occurrencesBetween(rule, from, horizon)[0] ?? null;
}

/**
 * Valor mensal equivalente (para orçamento e comprometimento de renda), em centavos.
 * Semanal: × 52 / 12. Anual: ÷ 12. Arredonda meio-para-cima.
 */
export function monthlyEquivalentCents(amountCents: bigint, frequency: Frequency, interval: number): bigint {
  const i = BigInt(Math.max(1, interval));
  const [num, den] =
    frequency === 'weekly' ? [52n, 12n * i] : frequency === 'monthly' ? [1n, i] : [1n, 12n * i];
  const scaled = amountCents * num * 2n;
  return (scaled / den + 1n) / 2n;
}
