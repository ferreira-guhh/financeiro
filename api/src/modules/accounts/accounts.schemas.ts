import { z } from 'zod';
import { accountTypeEnum } from '../../db/schema.js';
import { hexColorSchema, signedMoneySchema } from '../../shared/schemas.js';

/** Contas de cartão são criadas pelo módulo de cartões (Fase 2), não aqui. */
export const manualAccountTypes = ['checking', 'savings', 'investment', 'wallet', 'other'] as const;

export const createAccountBodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(manualAccountTypes),
  initialBalance: signedMoneySchema.default('0.00'),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Moeda deve ser ISO 4217, ex.: BRL')
    .default('BRL'),
  color: hexColorSchema.optional(),
});

/** Tipo e moeda são imutáveis: mudar depois de ter lançamentos corromperia o histórico. */
export const updateAccountBodySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    initialBalance: signedMoneySchema,
    color: hexColorSchema.nullable(),
    isActive: z.boolean(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Envie ao menos um campo para atualizar');

export const listAccountsQuerySchema = z.object({
  includeInactive: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export const accountResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: z.enum(accountTypeEnum.enumValues),
  currency: z.string(),
  color: z.string().nullable(),
  isActive: z.boolean(),
  initialBalance: z.string(),
  /** initialBalance + transações concluídas. */
  balance: z.string(),
  /** Soma das transações pendentes (agendadas, não compensadas). */
  pendingAmount: z.string(),
  /** balance + pendingAmount. */
  projectedBalance: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const accountListResponseSchema = z.object({
  data: z.array(accountResponseSchema),
  totals: z.object({
    /** Soma por moeda — nunca somamos BRL com USD. */
    byCurrency: z.array(
      z.object({ currency: z.string(), balance: z.string(), projectedBalance: z.string() }),
    ),
  }),
});

export type CreateAccountBody = z.infer<typeof createAccountBodySchema>;
export type UpdateAccountBody = z.infer<typeof updateAccountBodySchema>;
export type AccountResponse = z.infer<typeof accountResponseSchema>;
