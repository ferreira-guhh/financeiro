import { z } from 'zod';
import {
  paymentMethodEnum,
  transactionSourceEnum,
  transactionStatusEnum,
  transactionTypeEnum,
} from '../../db/schema.js';
import { normalizeMoney } from '../../lib/money.js';
import {
  isoDateSchema,
  paginationQuerySchema,
  positiveMoneySchema,
  uuidSchema,
} from '../../shared/schemas.js';

const paymentMethod = z.enum(paymentMethodEnum.enumValues);
/** Status que o usuário pode definir; `cancelled` só via DELETE. */
const writableStatus = z.enum(['pending', 'completed']);
const description = z.string().trim().min(1).max(255);
const notes = z.string().trim().max(2000);

// ─── Entrada ─────────────────────────────────────────────────────────────────

export const createTransactionBodySchema = z.object({
  accountId: uuidSchema,
  /** Transferências têm rota própria (POST /transfers). */
  type: z.enum(['income', 'expense']),
  /** Valor ABSOLUTO. O sinal é aplicado pelo backend conforme `type`. */
  amount: positiveMoneySchema,
  date: isoDateSchema,
  description,
  /** Texto original do extrato. Se omitido, usa `description`. Base do fingerprint. */
  rawDescription: description.optional(),
  categoryId: uuidSchema.optional(),
  status: writableStatus.default('completed'),
  paymentMethod: paymentMethod.optional(),
  notes: notes.optional(),
  /**
   * Confirma que é uma segunda transação idêntica e legítima
   * (mesma conta, data, valor e descrição). Sem isso, a API devolve 409.
   */
  allowDuplicate: z.boolean().default(false),
});

/**
 * `type`, `accountId` e `rawDescription` são imutáveis. Para mudar, cancele e recrie —
 * mantém trilha de auditoria e o fingerprint coerente com a origem.
 */
export const updateTransactionBodySchema = z
  .object({
    amount: positiveMoneySchema,
    date: isoDateSchema,
    description,
    categoryId: uuidSchema.nullable(),
    status: writableStatus,
    paymentMethod: paymentMethod.nullable(),
    notes: notes.nullable(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Envie ao menos um campo para atualizar');

export const createTransferBodySchema = z
  .object({
    fromAccountId: uuidSchema,
    toAccountId: uuidSchema,
    amount: positiveMoneySchema,
    date: isoDateSchema,
    description: description.default('Transferência entre contas'),
    status: writableStatus.default('completed'),
    notes: notes.optional(),
    allowDuplicate: z.boolean().default(false),
  })
  .refine((b) => b.fromAccountId !== b.toAccountId, {
    message: 'Conta de origem e destino devem ser diferentes',
    path: ['toAccountId'],
  });

export const listTransactionsQuerySchema = paginationQuerySchema.extend({
  accountId: uuidSchema.optional(),
  /** UUID de categoria, ou "none" para transações sem categoria. */
  categoryId: z.union([uuidSchema, z.literal('none')]).optional(),
  type: z.enum(transactionTypeEnum.enumValues).optional(),
  /** Padrão: tudo exceto canceladas. */
  status: z.enum(transactionStatusEnum.enumValues).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  search: z.string().trim().min(1).max(100).optional(),
}).refine((q) => !q.from || !q.to || q.from <= q.to, {
  message: '`from` deve ser anterior ou igual a `to`',
  path: ['from'],
});

// ─── Saída ───────────────────────────────────────────────────────────────────

export const transactionResponseSchema = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  categoryId: z.uuid().nullable(),
  type: z.enum(transactionTypeEnum.enumValues),
  status: z.enum(transactionStatusEnum.enumValues),
  /** ASSINADO: saídas negativas. */
  amount: z.string(),
  date: z.string(),
  description: z.string(),
  rawDescription: z.string(),
  paymentMethod: paymentMethod.nullable(),
  notes: z.string().nullable(),
  source: z.enum(transactionSourceEnum.enumValues),
  fingerprint: z.string(),
  transferId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const transactionListResponseSchema = z.object({
  data: z.array(transactionResponseSchema),
  /** Passe em `cursor` para a próxima página. `null` = fim. */
  nextCursor: z.string().nullable(),
});

export const transferResponseSchema = z.object({
  transferId: z.uuid(),
  from: transactionResponseSchema,
  to: transactionResponseSchema,
});

export type CreateTransactionBody = z.infer<typeof createTransactionBodySchema>;
export type UpdateTransactionBody = z.infer<typeof updateTransactionBodySchema>;
export type CreateTransferBody = z.infer<typeof createTransferBodySchema>;
export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>;
export type TransactionResponse = z.infer<typeof transactionResponseSchema>;

export function toTransactionResponse(row: {
  id: string;
  accountId: string;
  categoryId: string | null;
  type: TransactionResponse['type'];
  status: TransactionResponse['status'];
  amount: string;
  date: string;
  description: string;
  rawDescription: string;
  paymentMethod: TransactionResponse['paymentMethod'];
  notes: string | null;
  source: TransactionResponse['source'];
  fingerprint: string;
  transferId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): TransactionResponse {
  return {
    id: row.id,
    accountId: row.accountId,
    categoryId: row.categoryId,
    type: row.type,
    status: row.status,
    amount: normalizeMoney(row.amount),
    date: row.date,
    description: row.description,
    rawDescription: row.rawDescription,
    paymentMethod: row.paymentMethod,
    notes: row.notes,
    source: row.source,
    fingerprint: row.fingerprint,
    transferId: row.transferId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
