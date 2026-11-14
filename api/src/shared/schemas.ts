import { z } from 'zod';
import { MAX_ABS_CENTS, isMoneyString, toCents } from '../lib/money.js';

/**
 * Dinheiro trafega SEMPRE como string decimal com ponto: "1234.56".
 * Números JSON são rejeitados de propósito — 0.1 + 0.2 nunca entra no sistema.
 */
const moneyBase = z
  .string({ error: 'Envie o valor como string, ex.: "1234.56"' })
  .trim()
  // `abort: true` impede que os refinamentos seguintes rodem sobre um formato inválido.
  .refine(isMoneyString, {
    message: 'Formato inválido. Use até 2 casas decimais com ponto, ex.: "1234.56"',
    abort: true,
  })
  .refine((v) => {
    const c = toCents(v);
    return (c < 0n ? -c : c) <= MAX_ABS_CENTS;
  }, 'Valor excede o limite de NUMERIC(15,2)');

/** Aceita negativo (ex.: saldo inicial de conta no cheque especial). */
export const signedMoneySchema = moneyBase.meta({ example: '-150.00' });

/** Estritamente > 0 (valores de lançamento; o sinal vem do `type`). */
export const positiveMoneySchema = moneyBase
  .refine((v) => !v.startsWith('-') && toCents(v) > 0n, 'O valor deve ser maior que zero')
  .meta({ example: '89.90' });

export const isoDateSchema = z.iso.date({ error: 'Data inválida. Use YYYY-MM-DD' });

export const uuidSchema = z.uuid({ error: 'ID inválido' });

export const idParamsSchema = z.object({ id: uuidSchema });

export const hexColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Cor deve ser hexadecimal, ex.: #22C55E');

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});
