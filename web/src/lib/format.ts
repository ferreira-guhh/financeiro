/**
 * Formatação pt-BR feita sobre STRINGS decimais vindas da API ("1234.56"),
 * sem passar por float — o mesmo princípio do backend.
 */

const MINUS = '−';

/** "1234.5" → "1.234,50" (sem símbolo). */
export function formatNumber(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const negative = value.startsWith('-');
  const [int = '0', frac = ''] = value.replace('-', '').split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative && /[1-9]/.test(value) ? MINUS : ''}${grouped},${frac.padEnd(2, '0').slice(0, 2)}`;
}

/** "−1234.5" → "−R$ 1.234,50" */
export function formatBRL(value: string | null | undefined, opts: { sign?: boolean } = {}): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = formatNumber(value);
  if (n.startsWith(MINUS)) return `${MINUS}R$ ${n.slice(1)}`;
  return `${opts.sign && /[1-9]/.test(value) ? '+' : ''}R$ ${n}`;
}

/** Valor compacto para eixos: 12.500 → "12,5 mil". Só para rótulos de gráfico. */
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? MINUS : '';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1).replace('.', ',')} mi`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1).replace('.', ',')} mil`;
  return `${sign}${Math.round(abs)}`;
}

export function formatPercent(value: string | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  return `${n < 0 ? MINUS : ''}${Math.abs(n).toFixed(digits).replace('.', ',')}%`;
}

export const isNegative = (v: string | null | undefined) => Boolean(v && v.startsWith('-') && /[1-9]/.test(v));
export const isPositive = (v: string | null | undefined) => Boolean(v && !v.startsWith('-') && /[1-9]/.test(v));

/**
 * Entrada do usuário → string para a API. Aceita "1.234,56", "1234,56", "1234.56", "R$ 50".
 * Devolve null se inválido.
 */
export function parseMoneyInput(raw: string): string | null {
  let s = raw.trim().replace(/R\$|\s/g, '');
  if (!s) return null;
  const negative = s.startsWith('-') || s.startsWith(MINUS);
  s = s.replace(/^[-−]/, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(s)) return null;
  const [int, frac = ''] = s.split('.');
  return `${negative ? '-' : ''}${Number(int)}.${frac.padEnd(2, '0')}`;
}

/** "1234.50" → "1234,50" para preencher inputs. */
export const moneyToInput = (v: string | null | undefined) => (v ? v.replace('.', ',') : '');

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MONTHS_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** "2026-11-15" → "15/11/2026" */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** "2026-11-15" → "15 nov" */
export function formatDayMonth(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
}

/** "2026-11" → "nov/26" */
export function formatMonthShort(key: string): string {
  const [y, m] = key.split('-');
  return `${MONTHS[Number(m) - 1]}/${y!.slice(2)}`;
}

/** "2026-11" → "Novembro de 2026" (para títulos). */
export function formatMonthTitle(key: string): string {
  const s = formatMonthLong(key);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "2026-11" → "novembro de 2026" */
export function formatMonthLong(key: string): string {
  const [y, m] = key.split('-');
  return `${MONTHS_LONG[Number(m) - 1]} de ${y}`;
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const currentMonth = () => todayISO().slice(0, 7);

export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function shiftDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + delta)).toISOString().slice(0, 10);
}

export const toNumber = (v: string | null | undefined) => (v ? Number(v) : 0);
