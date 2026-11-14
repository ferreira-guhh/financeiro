/**
 * Aritmética monetária determinística em centavos (BigInt).
 *
 * O formato canônico na API e no banco é string decimal com 2 casas: "-1234.50".
 * Nada aqui passa por Number/float.
 */

const MONEY_RE = /^(-)?(\d{1,13})(?:\.(\d{1,2}))?$/;

/** Maior valor representável em NUMERIC(15,2). */
export const MAX_ABS_CENTS = 999_999_999_999_99n;

export class InvalidMoneyError extends Error {
  constructor(value: string) {
    super(`Valor monetário inválido: "${value}"`);
    this.name = 'InvalidMoneyError';
  }
}

export function isMoneyString(value: string): boolean {
  return MONEY_RE.test(value);
}

/** "12.5" → 1250n, "-0.01" → -1n */
export function toCents(value: string): bigint {
  const match = MONEY_RE.exec(value.trim());
  if (!match) throw new InvalidMoneyError(value);
  const [, minus, int, frac = ''] = match;
  const cents = BigInt(int!) * 100n + BigInt(frac.padEnd(2, '0'));
  return minus && cents !== 0n ? -cents : cents;
}

/** 1250n → "12.50", -1n → "-0.01" */
export function fromCents(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const int = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${int}.${frac}`;
}

/** Normaliza qualquer string monetária válida (ou retorno do NUMERIC) para "0.00". */
export function normalizeMoney(value: string): string {
  return fromCents(toCents(value));
}

export function sumMoney(values: string[]): string {
  return fromCents(values.reduce((acc, v) => acc + toCents(v), 0n));
}

export function negateMoney(value: string): string {
  return fromCents(-toCents(value));
}

export function absMoney(value: string): string {
  const cents = toCents(value);
  return fromCents(cents < 0n ? -cents : cents);
}
