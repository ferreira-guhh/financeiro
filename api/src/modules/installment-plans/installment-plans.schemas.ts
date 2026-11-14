import { z } from 'zod';
import { installmentPlanStatusEnum, installmentStatusEnum } from '../../db/schema.js';
import { isoDateSchema, positiveMoneySchema, uuidSchema } from '../../shared/schemas.js';

export const installmentInputShape = {
  description: z.string().trim().min(1).max(200),
  categoryId: uuidSchema.optional(),
  purchaseDate: isoDateSchema,
  installmentCount: z.number().int().min(2).max(420),
  /** Informe o total (dividido igualmente) OU o valor da parcela (compras com juros). */
  totalAmount: positiveMoneySchema.optional(),
  installmentAmount: positiveMoneySchema.optional(),
};

const exactlyOneAmount = (b: { totalAmount?: string; installmentAmount?: string }) =>
  Boolean(b.totalAmount) !== Boolean(b.installmentAmount);
const amountMessage = { message: 'Informe totalAmount OU installmentAmount', path: ['totalAmount'] };

export const createInstallmentPlanBodySchema = z
  .object({ accountId: uuidSchema, ...installmentInputShape })
  .refine(exactlyOneAmount, amountMessage);

export const listInstallmentPlansQuerySchema = z.object({
  status: z.enum(installmentPlanStatusEnum.enumValues).optional(),
  accountId: uuidSchema.optional(),
});

export const cancelInstallmentPlanQuerySchema = z.object({
  /** Também cancela parcelas já lançadas cujas faturas ainda estão abertas. */
  cancelPosted: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

export const scheduleQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(60).default(12),
});

export const installmentResponseSchema = z.object({
  id: z.uuid(),
  number: z.number(),
  amount: z.string(),
  date: z.string(),
  status: z.enum(installmentStatusEnum.enumValues),
  invoiceKey: z.string().nullable(),
  transactionId: z.uuid().nullable(),
});

export const installmentPlanResponseSchema = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  accountName: z.string(),
  accountType: z.string(),
  categoryId: z.uuid().nullable(),
  description: z.string(),
  status: z.enum(installmentPlanStatusEnum.enumValues),
  totalAmount: z.string(),
  installmentCount: z.number(),
  installmentAmount: z.string(),
  firstInstallmentAmount: z.string(),
  purchaseDate: z.string(),
  firstDate: z.string(),
  lastDate: z.string(),
  /** Parcela atual = quantidade já lançada no livro-caixa. */
  currentInstallment: z.number(),
  remainingCount: z.number(),
  postedAmount: z.string(),
  remainingAmount: z.string(),
  nextDate: z.string().nullable(),
  installments: z.array(installmentResponseSchema).optional(),
});

export const scheduleResponseSchema = z.object({
  months: z.array(
    z.object({ month: z.string(), total: z.string(), count: z.number(), cardTotal: z.string() }),
  ),
  totalCommitted: z.string(),
});

export type CreateInstallmentPlanBody = z.infer<typeof createInstallmentPlanBodySchema>;
export type InstallmentPlanResponse = z.infer<typeof installmentPlanResponseSchema>;
