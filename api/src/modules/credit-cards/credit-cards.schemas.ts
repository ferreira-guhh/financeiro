import { z } from 'zod';
import { hexColorSchema, isoDateSchema, positiveMoneySchema, uuidSchema } from '../../shared/schemas.js';
import { installmentInputShape } from '../installment-plans/installment-plans.schemas.js';

const day = z.number().int().min(1).max(31);

export const createCreditCardBodySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    color: hexColorSchema.optional(),
    creditLimit: positiveMoneySchema,
    closingDay: day,
    dueDay: day,
    /** Conta que normalmente paga a fatura. */
    paymentAccountId: uuidSchema.optional(),
  })
  .refine((b) => b.closingDay !== b.dueDay, {
    message: 'Dia de vencimento deve ser diferente do dia de fechamento',
    path: ['dueDay'],
  });

export const updateCreditCardBodySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    color: hexColorSchema.nullable(),
    creditLimit: positiveMoneySchema,
    closingDay: day,
    dueDay: day,
    paymentAccountId: uuidSchema.nullable(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Envie ao menos um campo para atualizar');

export const purchaseBodySchema = z
  .object({
    description: installmentInputShape.description,
    categoryId: uuidSchema.optional(),
    date: isoDateSchema,
    /** expense = compra; income = estorno/cashback. */
    type: z.enum(['expense', 'income']).default('expense'),
    amount: positiveMoneySchema.optional(),
    /** 1 = à vista. ≥ 2 cria um parcelamento. */
    installments: z.number().int().min(1).max(420).default(1),
    /** Para parcelado com juros: valor de cada parcela (em vez de `amount` total). */
    installmentAmount: positiveMoneySchema.optional(),
    notes: z.string().trim().max(2000).optional(),
    allowDuplicate: z.boolean().default(false),
  })
  .refine((b) => Boolean(b.amount) !== Boolean(b.installmentAmount), {
    message: 'Informe amount (total) OU installmentAmount',
    path: ['amount'],
  })
  .refine((b) => b.installments === 1 || b.type === 'expense', {
    message: 'Estorno não pode ser parcelado',
    path: ['installments'],
  })
  .refine((b) => !b.installmentAmount || b.installments > 1, {
    message: 'installmentAmount só vale para compras parceladas',
    path: ['installmentAmount'],
  });

export const invoiceParamsSchema = z.object({
  id: uuidSchema,
  year: z.coerce.number().int().min(2000).max(2200),
  month: z.coerce.number().int().min(1).max(12),
});

export const payInvoiceBodySchema = z.object({
  /** Padrão: conta pagadora do cartão. */
  fromAccountId: uuidSchema.optional(),
  /** Padrão: valor restante da fatura. */
  amount: positiveMoneySchema.optional(),
  date: isoDateSchema,
  status: z.enum(['pending', 'completed']).default('completed'),
});

export const invoiceSummarySchema = z.object({
  id: z.uuid(),
  year: z.number(),
  month: z.number(),
  key: z.string(),
  closingDate: z.string(),
  dueDate: z.string(),
  status: z.enum(['open', 'closed', 'paid', 'overdue']),
  total: z.string(),
  posted: z.string(),
  scheduled: z.string(),
  paid: z.string(),
  pendingPayment: z.string(),
  remaining: z.string(),
  itemCount: z.number(),
  /** Recorrências do cartão (assinaturas) previstas para esta fatura e ainda não lançadas. */
  projectedRecurring: z.string(),
});

export const creditCardResponseSchema = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  name: z.string(),
  color: z.string().nullable(),
  isActive: z.boolean(),
  creditLimit: z.string(),
  usedLimit: z.string(),
  availableLimit: z.string(),
  closingDay: z.number(),
  dueDay: z.number(),
  paymentAccountId: z.uuid().nullable(),
  currentInvoice: invoiceSummarySchema.nullable(),
  /** Próxima fatura com valor a pagar (fechada/vencida ou a atual). */
  nextDueInvoice: invoiceSummarySchema.nullable(),
});

export const invoiceItemSchema = z.object({
  kind: z.enum(['transaction', 'scheduled_installment', 'projected_recurring', 'payment']),
  id: z.string().nullable(),
  date: z.string(),
  description: z.string(),
  /** Valor da fatura: compras positivas, estornos e pagamentos negativos. */
  amount: z.string(),
  categoryId: z.uuid().nullable(),
  status: z.string().nullable(),
});

export const invoiceDetailSchema = invoiceSummarySchema.extend({
  cardId: z.uuid(),
  items: z.array(invoiceItemSchema),
});

export type CreateCreditCardBody = z.infer<typeof createCreditCardBodySchema>;
export type UpdateCreditCardBody = z.infer<typeof updateCreditCardBodySchema>;
export type PurchaseBody = z.infer<typeof purchaseBodySchema>;
export type PayInvoiceBody = z.infer<typeof payInvoiceBodySchema>;
export type InvoiceSummaryResponse = z.infer<typeof invoiceSummarySchema>;
export type CreditCardResponse = z.infer<typeof creditCardResponseSchema>;
