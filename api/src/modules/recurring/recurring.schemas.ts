import { z } from 'zod';
import { paymentMethodEnum, recurrenceFrequencyEnum } from '../../db/schema.js';
import { isoDateSchema, positiveMoneySchema, uuidSchema } from '../../shared/schemas.js';

const frequency = z.enum(recurrenceFrequencyEnum.enumValues);
const dayOfMonth = z.number().int().min(1).max(31);

export const createRecurringBodySchema = z
  .object({
    accountId: uuidSchema,
    categoryId: uuidSchema.optional(),
    type: z.enum(['income', 'expense']),
    /** Valor absoluto (estimado, para contas variáveis como energia). */
    amount: positiveMoneySchema,
    description: z.string().trim().min(1).max(255),
    paymentMethod: z.enum(paymentMethodEnum.enumValues).optional(),
    frequency: frequency.default('monthly'),
    interval: z.number().int().min(1).max(365).default(1),
    /** Padrão: dia da data de início. */
    dayOfMonth: dayOfMonth.optional(),
    startDate: isoDateSchema,
    endDate: isoDateSchema.optional(),
    autoConfirm: z.boolean().default(false),
    /**
     * Gera também as ocorrências passadas desde startDate (máx. 24 meses), já como realizadas.
     * Padrão: sem retroativo antes do mês atual.
     */
    backfill: z.boolean().default(false),
  })
  .refine((b) => !b.endDate || b.endDate >= b.startDate, {
    message: 'endDate deve ser posterior a startDate',
    path: ['endDate'],
  });

export const updateRecurringBodySchema = z
  .object({
    categoryId: uuidSchema.nullable(),
    amount: positiveMoneySchema,
    description: z.string().trim().min(1).max(255),
    paymentMethod: z.enum(paymentMethodEnum.enumValues).nullable(),
    dayOfMonth,
    endDate: isoDateSchema.nullable(),
    autoConfirm: z.boolean(),
    isActive: z.boolean(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Envie ao menos um campo para atualizar');

export const upcomingQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(366).default(30),
});

export const recurringResponseSchema = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  accountName: z.string(),
  accountType: z.string(),
  categoryId: z.uuid().nullable(),
  type: z.enum(['income', 'expense']),
  amount: z.string(),
  description: z.string(),
  paymentMethod: z.string().nullable(),
  frequency,
  interval: z.number(),
  dayOfMonth: z.number().nullable(),
  startDate: z.string(),
  endDate: z.string().nullable(),
  lastGeneratedDate: z.string().nullable(),
  autoConfirm: z.boolean(),
  isActive: z.boolean(),
  nextOccurrence: z.string().nullable(),
  monthlyEquivalent: z.string(),
});

export const upcomingItemSchema = z.object({
  date: z.string(),
  description: z.string(),
  /** Assinado: saídas negativas. */
  amount: z.string(),
  accountId: z.uuid(),
  categoryId: z.uuid().nullable(),
  recurringTransactionId: z.uuid().nullable(),
  /** pending = já está no livro-caixa aguardando confirmação; projected = ocorrência futura virtual. */
  kind: z.enum(['pending', 'projected']),
  transactionId: z.uuid().nullable(),
  overdue: z.boolean(),
});

export const suggestionSchema = z.object({
  description: z.string(),
  accountId: z.uuid(),
  categoryId: z.uuid().nullable(),
  type: z.enum(['income', 'expense']),
  amount: z.string(),
  dayOfMonth: z.number(),
  occurrences: z.number(),
  lastDate: z.string(),
  /** Variação do valor entre ocorrências, em %. */
  amountVariationPercent: z.string(),
});

export type CreateRecurringBody = z.infer<typeof createRecurringBodySchema>;
export type UpdateRecurringBody = z.infer<typeof updateRecurringBodySchema>;
export type RecurringResponse = z.infer<typeof recurringResponseSchema>;
export type UpcomingItem = z.infer<typeof upcomingItemSchema>;
