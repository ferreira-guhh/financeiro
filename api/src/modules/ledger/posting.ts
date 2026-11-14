/**
 * Porta única de entrada no livro-caixa.
 *
 * Toda transação — manual, de cartão, parcela, recorrência ou importação — passa por aqui,
 * garantindo as mesmas regras: sinal pelo tipo, fingerprint idempotente e vínculo
 * automático com a fatura quando a conta é um cartão.
 */
import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client.js';
import { accounts, creditCards, invoices, transactions } from '../../db/schema.js';
import { invoicePeriodForDate, type InvoicePeriod } from '../../domain/credit-card.js';
import { computeFingerprint } from '../../lib/fingerprint.js';
import { fromCents, normalizeMoney, toCents } from '../../lib/money.js';
import { AppError, businessRule } from '../../shared/errors.js';

export type NewTransaction = typeof transactions.$inferInsert;
export type TransactionRow = typeof transactions.$inferSelect;
export type AccountRow = typeof accounts.$inferSelect;
export type CreditCardRow = typeof creditCards.$inferSelect;

/** Limite de cópias idênticas confirmadas no mesmo dia (proteção contra loop). */
const MAX_DUPLICATE_OCCURRENCES = 50;

/** income → +valor, expense → −valor. Entrada sempre absoluta (validada pelo Zod). */
export function signedAmount(type: 'income' | 'expense', absolute: string): string {
  const cents = toCents(absolute);
  return fromCents(type === 'expense' ? -cents : cents);
}

/**
 * Insere garantindo idempotência pelo fingerprint.
 *
 * Usa `ON CONFLICT DO NOTHING` em vez de "SELECT antes de INSERT": a constraint única
 * do banco é quem decide, então duas requisições simultâneas nunca geram duplicata.
 *
 * - allowDuplicate=false → 409 apontando a transação existente.
 * - allowDuplicate=true  → tenta a próxima ocorrência (#1, #2, ...) de forma determinística.
 */
export async function insertWithFingerprint(
  db: DbExecutor,
  values: Omit<NewTransaction, 'fingerprint'>,
  allowDuplicate: boolean,
): Promise<TransactionRow> {
  const amount = normalizeMoney(values.amount);

  for (let occurrence = 0; occurrence <= MAX_DUPLICATE_OCCURRENCES; occurrence++) {
    const fingerprint = computeFingerprint({
      accountId: values.accountId,
      date: values.date,
      amount,
      rawDescription: values.rawDescription,
      occurrence,
    });

    const [inserted] = await db
      .insert(transactions)
      .values({ ...values, amount, fingerprint })
      .onConflictDoNothing({ target: [transactions.accountId, transactions.fingerprint] })
      .returning();

    if (inserted) return inserted;

    if (!allowDuplicate) {
      const [existing] = await db
        .select({ id: transactions.id, status: transactions.status })
        .from(transactions)
        .where(
          and(eq(transactions.accountId, values.accountId), eq(transactions.fingerprint, fingerprint)),
        )
        .limit(1);

      throw new AppError(
        409,
        'DUPLICATE_TRANSACTION',
        'Já existe uma transação idêntica (conta, data, valor e descrição). Envie allowDuplicate=true se for intencional.',
        { existingTransactionId: existing?.id, existingStatus: existing?.status },
      );
    }
  }

  throw businessRule(`Limite de ${MAX_DUPLICATE_OCCURRENCES} transações idênticas atingido`);
}

export async function getCardByAccount(db: DbExecutor, accountId: string): Promise<CreditCardRow> {
  const [card] = await db.select().from(creditCards).where(eq(creditCards.accountId, accountId)).limit(1);
  if (!card) throw businessRule('Conta de cartão sem cadastro de cartão associado', { accountId });
  return card;
}

/** Garante a linha da fatura (período) e devolve o id. Idempotente e seguro sob concorrência. */
export async function ensureInvoice(
  db: DbExecutor,
  creditCardId: string,
  period: InvoicePeriod,
): Promise<string> {
  const [created] = await db
    .insert(invoices)
    .values({
      creditCardId,
      year: period.year,
      month: period.month,
      closingDate: period.closingDate,
      dueDate: period.dueDate,
    })
    .onConflictDoNothing({ target: [invoices.creditCardId, invoices.year, invoices.month] })
    .returning({ id: invoices.id });
  if (created) return created.id;

  const [existing] = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(
      and(
        eq(invoices.creditCardId, creditCardId),
        eq(invoices.year, period.year),
        eq(invoices.month, period.month),
      ),
    )
    .limit(1);
  return existing!.id;
}

export interface PostEntryInput {
  userId: string;
  account: AccountRow;
  type: 'income' | 'expense';
  /** Valor absoluto. */
  amount: string;
  date: string;
  description: string;
  rawDescription?: string;
  categoryId?: string | null;
  status?: 'pending' | 'completed';
  paymentMethod?: NewTransaction['paymentMethod'];
  notes?: string | null;
  source: NonNullable<NewTransaction['source']>;
  fitId?: string | null;
  recurringTransactionId?: string | null;
  recurrenceDate?: string | null;
  /** Força a fatura (parcelas já nascem vinculadas à sua fatura). */
  invoiceId?: string | null;
  allowDuplicate?: boolean;
}

/** Lança receita/despesa em qualquer conta, inclusive cartão (vincula à fatura da data). */
export async function postEntry(db: DbExecutor, input: PostEntryInput): Promise<TransactionRow> {
  let invoiceId = input.invoiceId ?? null;
  let paymentMethod = input.paymentMethod ?? null;

  if (input.account.type === 'credit_card') {
    if (!invoiceId) {
      const card = await getCardByAccount(db, input.account.id);
      invoiceId = await ensureInvoice(db, card.id, invoicePeriodForDate(input.date, card));
    }
    paymentMethod = 'credit_card';
  }

  return insertWithFingerprint(
    db,
    {
      userId: input.userId,
      accountId: input.account.id,
      categoryId: input.categoryId ?? null,
      type: input.type,
      status: input.status ?? 'completed',
      amount: signedAmount(input.type, input.amount),
      date: input.date,
      description: input.description,
      rawDescription: input.rawDescription ?? input.description,
      paymentMethod,
      notes: input.notes ?? null,
      source: input.source,
      fitId: input.fitId ?? null,
      invoiceId,
      recurringTransactionId: input.recurringTransactionId ?? null,
      recurrenceDate: input.recurrenceDate ?? null,
    },
    input.allowDuplicate ?? false,
  );
}
