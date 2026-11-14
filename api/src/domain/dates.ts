/**
 * Aritmética de datas contábeis em strings ISO (YYYY-MM-DD / YYYY-MM), sem fuso horário.
 * Tudo é calculado em UTC puro para que "2026-03-31 + 1 mês" nunca dependa do servidor.
 */

export type ISODate = string; // YYYY-MM-DD
export type MonthKey = string; // YYYY-MM

const pad = (n: number, len = 2) => String(n).padStart(len, '0');

export function parseDate(date: ISODate): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y!, m!, d!];
}

export function formatDate(year: number, month: number, day: number): ISODate {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Dia `day` do mês, limitado ao último dia (31 em fevereiro → 28/29). */
export function clampedDate(year: number, month: number, day: number): ISODate {
  // Normaliza mês fora de 1..12 (ex.: mês 13 → janeiro do ano seguinte).
  const normalized = new Date(Date.UTC(year, month - 1, 1));
  const y = normalized.getUTCFullYear();
  const m = normalized.getUTCMonth() + 1;
  return formatDate(y, m, Math.min(day, daysInMonth(y, m)));
}

function toUtc(date: ISODate): number {
  const [y, m, d] = parseDate(date);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): ISODate {
  const dt = new Date(ms);
  return formatDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(date: ISODate, days: number): ISODate {
  return fromUtc(toUtc(date) + days * 86_400_000);
}

/** Soma meses mantendo o dia âncora (limitado ao fim do mês). */
export function addMonths(date: ISODate, months: number, anchorDay?: number): ISODate {
  const [y, m, d] = parseDate(date);
  return clampedDate(y, m + months, anchorDay ?? d);
}

export function diffDays(from: ISODate, to: ISODate): number {
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

/** 0 = domingo ... 6 = sábado */
export function dayOfWeek(date: ISODate): number {
  return new Date(toUtc(date)).getUTCDay();
}

/** Segunda-feira da semana que contém a data. */
export function weekStart(date: ISODate): ISODate {
  const dow = dayOfWeek(date);
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

export const minDate = (a: ISODate, b: ISODate) => (a < b ? a : b);
export const maxDate = (a: ISODate, b: ISODate) => (a > b ? a : b);

// ─── Meses ───────────────────────────────────────────────────────────────────

export const monthKey = (date: ISODate): MonthKey => date.slice(0, 7);

export function parseMonth(key: MonthKey): [number, number] {
  const [y, m] = key.split('-').map(Number);
  return [y!, m!];
}

export function monthStart(key: MonthKey): ISODate {
  return `${key}-01`;
}

export function monthEnd(key: MonthKey): ISODate {
  const [y, m] = parseMonth(key);
  return formatDate(y, m, daysInMonth(y, m));
}

export function addMonthsToKey(key: MonthKey, months: number): MonthKey {
  const [y, m] = parseMonth(key);
  return monthKey(clampedDate(y, m + months, 1));
}

/** Número de meses de `from` até `to` (2026-01 → 2026-03 = 2). */
export function monthsBetween(from: MonthKey, to: MonthKey): number {
  const [y1, m1] = parseMonth(from);
  const [y2, m2] = parseMonth(to);
  return (y2 - y1) * 12 + (m2 - m1);
}

/** Lista inclusiva de meses. */
export function monthRange(from: MonthKey, to: MonthKey): MonthKey[] {
  const count = monthsBetween(from, to);
  return Array.from({ length: Math.max(0, count + 1) }, (_, i) => addMonthsToKey(from, i));
}

export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = parseDate(date);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}
