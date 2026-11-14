/**
 * Valores derivados das faturas (total, pago, restante, status) — sempre calculados
 * a partir do livro-caixa + parcelas agendadas. Compartilhado por cartões, transferências,
 * dashboard e previsão.
 */
import { and, asc, eq, inArray, lte, ne, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client.js';
import { installments, invoices, transactions } from '../../db/schema.js';
import { invoiceStatus, type InvoiceStatus } from '../../domain/credit-card.js';
import { fromCents, normalizeMoney, toCents } from '../../lib/money.js';

export type InvoiceRow = typeof invoices.$inferSelect;

export interface InvoiceAmounts {
  /** Compras − estornos já lançados no livro-caixa. */
  postedCents: bigint;
  /** Parcelas agendadas (ainda virtuais) vinculadas à fatura. */
  scheduledCents: bigint;
  totalCents: bigint;
  paidCents: bigint;
  /** Pagamentos agendados (pendentes). */
  pendingPaymentCents: bigint;
  itemCount: number;
}

const EMPTY: InvoiceAmounts = {
  postedCents: 0n,
  scheduledCents: 0n,
  totalCents: 0n,
  paidCents: 0n,
  pendingPaymentCents: 0n,
  itemCount: 0,
};

export async function invoiceAmounts(db: DbExecutor, invoiceIds: string[]): Promise<Map<string, InvoiceAmounts>> {
  const result = new Map<string, InvoiceAmounts>();
  if (invoiceIds.length === 0) return result;

  const ledger = await db
    .select({
      invoiceId: transactions.invoiceId,
      charges: sql<string>`coalesce(sum(-${transactions.amount}) filter (where ${transactions.type} <> 'transfer'), 0)`,
      paid: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'transfer' and ${transactions.status} = 'completed'), 0)`,
      pendingPaid: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'transfer' and ${transactions.status} = 'pending'), 0)`,
      count: sql<number>`count(*) filter (where ${transactions.type} <> 'transfer')::int`,
    })
    .from(transactions)
    .where(and(inArray(transactions.invoiceId, invoiceIds), ne(transactions.status, 'cancelled')))
    .groupBy(transactions.invoiceId);

  const scheduled = await db
    .select({
      invoiceId: installments.invoiceId,
      total: sql<string>`coalesce(sum(${installments.amount}), 0)`,
      count: sql<number>`count(*)::int`,
    })
    .from(installments)
    .where(and(inArray(installments.invoiceId, invoiceIds), eq(installments.status, 'scheduled')))
    .groupBy(installments.invoiceId);

  for (const id of invoiceIds) result.set(id, { ...EMPTY });
  for (const row of ledger) {
    const entry = result.get(row.invoiceId!)!;
    entry.postedCents = toCents(normalizeMoney(row.charges));
    entry.paidCents = toCents(normalizeMoney(row.paid));
    entry.pendingPaymentCents = toCents(normalizeMoney(row.pendingPaid));
    entry.itemCount += row.count;
  }
  for (const row of scheduled) {
    const entry = result.get(row.invoiceId!)!;
    entry.scheduledCents = toCents(normalizeMoney(row.total));
    entry.itemCount += row.count;
  }
  for (const entry of result.values()) entry.totalCents = entry.postedCents + entry.scheduledCents;
  return result;
}

export interface InvoiceSummary {
  id: string;
  year: number;
  month: number;
  key: string;
  closingDate: string;
  dueDate: string;
  status: InvoiceStatus;
  total: string;
  posted: string;
  scheduled: string;
  paid: string;
  pendingPayment: string;
  remaining: string;
  itemCount: number;
}

export function summarizeInvoice(row: InvoiceRow, amounts: InvoiceAmounts, today: string): InvoiceSummary {
  const remaining = amounts.totalCents - amounts.paidCents;
  return {
    id: row.id,
    year: row.year,
    month: row.month,
    key: `${row.year}-${String(row.month).padStart(2, '0')}`,
    closingDate: row.closingDate,
    dueDate: row.dueDate,
    status: invoiceStatus({
      today,
      closingDate: row.closingDate,
      dueDate: row.dueDate,
      totalCents: amounts.totalCents,
      paidCents: amounts.paidCents,
    }),
    total: fromCents(amounts.totalCents),
    posted: fromCents(amounts.postedCents),
    scheduled: fromCents(amounts.scheduledCents),
    paid: fromCents(amounts.paidCents),
    pendingPayment: fromCents(amounts.pendingPaymentCents),
    remaining: fromCents(remaining > 0n ? remaining : 0n),
    itemCount: amounts.itemCount,
  };
}

export async function listInvoiceSummaries(
  db: DbExecutor,
  creditCardId: string,
  today: string,
): Promise<InvoiceSummary[]> {
  const rows = await db
    .select()
    .from(invoices)
    .where(eq(invoices.creditCardId, creditCardId))
    .orderBy(asc(invoices.year), asc(invoices.month));
  const amounts = await invoiceAmounts(db, rows.map((r) => r.id));
  return rows.map((r) => summarizeInvoice(r, amounts.get(r.id)!, today));
}

/**
 * Para qual fatura vai um pagamento feito em `date`:
 * a fatura FECHADA mais antiga ainda com saldo; se não houver, a fatura aberta da data.
 */
export async function resolvePaymentInvoiceId(
  db: DbExecutor,
  creditCardId: string,
  date: string,
  fallbackInvoiceId: () => Promise<string>,
): Promise<string> {
  const closed = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.creditCardId, creditCardId), lte(invoices.closingDate, date)))
    .orderBy(asc(invoices.year), asc(invoices.month));
  const amounts = await invoiceAmounts(db, closed.map((r) => r.id));
  const unpaid = closed.find((r) => {
    const a = amounts.get(r.id)!;
    return a.totalCents > a.paidCents + a.pendingPaymentCents;
  });
  return unpaid?.id ?? fallbackInvoiceId();
}
