import { Decimal } from 'decimal.js';

/**
 * Instância isolada do Decimal para o motor de simulações: 40 dígitos de precisão,
 * arredondamento meio-para-cima (padrão de valores em reais).
 */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof D>;

export const ZERO = new D(0);

/** Arredonda para centavos. */
export const cents = (v: Dec) => v.toDecimalPlaces(2, D.ROUND_HALF_UP);

/** Saída padronizada: string "1234.56". */
export const money = (v: Dec) => cents(v).toFixed(2);

/** Taxa mensal equivalente a uma taxa anual em %: (1 + a)^(1/12) − 1. */
export function monthlyRateFromAnnualPercent(annualPercent: string | number | Dec): Dec {
  const annual = new D(annualPercent).div(100);
  if (annual.lte(-1)) throw new Error('Taxa anual deve ser maior que -100%');
  return annual.plus(1).pow(new D(1).div(12)).minus(1);
}
