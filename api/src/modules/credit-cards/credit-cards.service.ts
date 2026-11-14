import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database, DbExecutor } from '../../db/client.js';
import { accounts, creditCards, installmentPlans, installments, invoices, transactions } from '../../db/schema.js';
import { invoicePeriodForDate, periodFromDueMonth, shiftPeriod, type InvoicePeriod } from '../../domain/credit-card.js';
import { addDays, maxDate } from '../../domain/dates.js';
import { today } from '../../lib/clock.js';
import { fromCents, normalizeMoney, toCents } from '../../lib/money.js';
import { AppError, PG_UNIQUE_VIOLATION, businessRule, getPgError, notFound } from '../../shared/errors.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { CategoriesService } from '../categories/categories.service.js';
import { autoCategoryId } from '../category-rules/categorizer.js';
import { InstallmentPlansService } from '../installment-plans/installment-plans.service.js';
import { ensureInvoice, postEntry, type CreditCardRow } from '../ledger/posting.js';
import { RecurringService, projectOccurrences, type RecurringRow } from '../recurring/recurring.service.js';
import { toTransactionResponse } from '../transactions/transactions.schemas.js';
import { TransactionsService } from '../transactions/transactions.service.js';
import type {
  CreateCreditCardBody,
  CreditCardResponse,
  InvoiceSummaryResponse,
  PayInvoiceBody,
  PurchaseBody,
  UpdateCreditCardBody,
} from './credit-cards.schemas.js';
import { invoiceAmounts, summarizeInvoice, type InvoiceRow } from './invoice-queries.js';

type CardWithAccount = { card: CreditCardRow; account: typeof accounts.$inferSelect };

/** Quantas faturas futuras mostrar além das que já têm lançamentos. */
const FUTURE_INVOICES = 3;

export class CreditCardsService {
  constructor(private readonly db: Database) {}

  async create(userId: string, input: CreateCreditCardBody) {
    const id = await this.db.transaction(async (tx) => {
      let currency = 'BRL';
      if (input.paymentAccountId) {
        const pay = await AccountsService.requireActiveAccount(tx, userId, input.paymentAccountId);
        if (pay.type === 'credit_card') throw businessRule('A conta pagadora não pode ser outro cartão');
        currency = pay.currency;
      }
      let account;
      try {
        [account] = await tx
          .insert(accounts)
          .values({ userId, name: input.name, type: 'credit_card', currency, color: input.color ?? null })
          .returning();
      } catch (err) {
        if (getPgError(err)?.code === PG_UNIQUE_VIOLATION) {
          throw new AppError(409, 'CONFLICT', 'Já existe uma conta ou cartão com esse nome');
        }
        throw err;
      }
      const [card] = await tx
        .insert(creditCards)
        .values({
          userId,
          accountId: account!.id,
          paymentAccountId: input.paymentAccountId ?? null,
          creditLimit: normalizeMoney(input.creditLimit),
          closingDay: input.closingDay,
          dueDay: input.dueDay,
        })
        .returning();
      await ensureInvoice(tx, card!.id, invoicePeriodForDate(today(), card!));
      return card!.id;
    });
    return this.get(userId, id);
  }

  async list(userId: string, includeInactive = false): Promise<CreditCardResponse[]> {
    const rows = await this.db
      .select({ card: creditCards, account: accounts })
      .from(creditCards)
      .innerJoin(accounts, eq(accounts.id, creditCards.accountId))
      .where(and(eq(creditCards.userId, userId), includeInactive ? undefined : eq(accounts.isActive, true)))
      .orderBy(asc(accounts.name));
    const rules = await RecurringService.activeRules(this.db, userId);
    return Promise.all(rows.map((r) => this.toResponse(r, rules)));
  }

  async get(userId: string, id: string): Promise<CreditCardResponse> {
    const row = await this.findOwned(this.db, userId, id);
    return this.toResponse(row, await RecurringService.activeRules(this.db, userId));
  }

  async update(userId: string, id: string, input: UpdateCreditCardBody) {
    const { card } = await this.findOwned(this.db, userId, id);
    const closingDay = input.closingDay ?? card.closingDay;
    const dueDay = input.dueDay ?? card.dueDay;
    if (closingDay === dueDay) throw businessRule('Dia de vencimento deve ser diferente do dia de fechamento');
    if (input.paymentAccountId) {
      const pay = await AccountsService.requireActiveAccount(this.db, userId, input.paymentAccountId);
      if (pay.type === 'credit_card') throw businessRule('A conta pagadora não pode ser outro cartão');
    }

    await this.db.transaction(async (tx) => {
      // Mudança de ciclo vale para faturas futuras; as existentes mantêm suas datas.
      await tx
        .update(creditCards)
        .set({
          ...(input.creditLimit && { creditLimit: normalizeMoney(input.creditLimit) }),
          ...(input.closingDay && { closingDay }),
          ...(input.dueDay && { dueDay }),
          ...(input.paymentAccountId !== undefined && { paymentAccountId: input.paymentAccountId }),
        })
        .where(eq(creditCards.id, id));
      if (input.name !== undefined || input.color !== undefined) {
        try {
          await tx
            .update(accounts)
            .set({
              ...(input.name && { name: input.name }),
              ...(input.color !== undefined && { color: input.color }),
            })
            .where(eq(accounts.id, card.accountId));
        } catch (err) {
          if (getPgError(err)?.code === PG_UNIQUE_VIOLATION) {
            throw new AppError(409, 'CONFLICT', 'Já existe uma conta ou cartão com esse nome');
          }
          throw err;
        }
      }
    });
    return this.get(userId, id);
  }

  async archive(userId: string, id: string) {
    const { card } = await this.findOwned(this.db, userId, id);
    await this.db.update(accounts).set({ isActive: false }).where(eq(accounts.id, card.accountId));
  }

  // ─── Compras ───────────────────────────────────────────────────────────────

  async purchase(userId: string, cardId: string, input: PurchaseBody) {
    return this.db.transaction(async (tx) => {
      const { account } = await this.findOwned(tx, userId, cardId);
      if (!account.isActive) throw businessRule('Cartão arquivado não aceita lançamentos');
      const categoryId =
        input.categoryId ?? (await autoCategoryId(tx, userId, { description: input.description, accountId: account.id, type: input.type })) ?? undefined;

      if (input.installments > 1) {
        const planId = await InstallmentPlansService.createPlan(tx, {
          userId,
          account,
          description: input.description,
          categoryId,
          purchaseDate: input.date,
          installmentCount: input.installments,
          totalAmount: input.amount,
          installmentAmount: input.installmentAmount,
        });
        return { kind: 'installment_plan' as const, installmentPlanId: planId, transaction: null };
      }

      if (input.categoryId) {
        await CategoriesService.requireUsableCategory(tx, userId, input.categoryId, input.type);
      }
      const row = await postEntry(tx, {
        userId,
        account,
        type: input.type,
        amount: input.amount!,
        date: input.date,
        description: input.description,
        categoryId,
        notes: input.notes,
        source: 'manual',
        allowDuplicate: input.allowDuplicate,
      });
      return { kind: 'transaction' as const, installmentPlanId: null, transaction: toTransactionResponse(row) };
    });
  }

  // ─── Faturas ───────────────────────────────────────────────────────────────

  /** Faturas com lançamentos + atual + próximas N (mesmo sem lançamentos ainda). */
  async listInvoices(userId: string, cardId: string): Promise<InvoiceSummaryResponse[]> {
    const { card, account } = await this.findOwned(this.db, userId, cardId);
    const now = today();
    const current = invoicePeriodForDate(now, card);
    for (let k = 0; k <= FUTURE_INVOICES; k++) {
      await ensureInvoice(this.db, card.id, shiftPeriod(current, k, card));
    }
    const rows = await this.db
      .select()
      .from(invoices)
      .where(eq(invoices.creditCardId, card.id))
      .orderBy(asc(invoices.year), asc(invoices.month));
    const amounts = await invoiceAmounts(this.db, rows.map((r) => r.id));
    const rules = (await RecurringService.activeRules(this.db, userId)).filter((r) => r.accountId === account.id);
    return rows.map((r) => withProjection(summarizeInvoice(r, amounts.get(r.id)!, now), r, card, rules, now));
  }

  async invoiceDetail(userId: string, cardId: string, year: number, month: number) {
    const { card, account } = await this.findOwned(this.db, userId, cardId);
    const now = today();
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const period = periodFromDueMonth(key, card);
    const invoiceId = await ensureInvoice(this.db, card.id, period);
    const [row] = await this.db.select().from(invoices).where(eq(invoices.id, invoiceId));
    const amounts = (await invoiceAmounts(this.db, [invoiceId])).get(invoiceId)!;
    const rules = (await RecurringService.activeRules(this.db, userId)).filter((r) => r.accountId === account.id);
    const summary = withProjection(summarizeInvoice(row!, amounts, now), row!, card, rules, now);

    const posted = await this.db
      .select()
      .from(transactions)
      .where(and(eq(transactions.invoiceId, invoiceId), sql`${transactions.status} <> 'cancelled'`))
      .orderBy(asc(transactions.date), asc(transactions.createdAt));
    const scheduled = await this.db
      .select({ inst: installments, plan: installmentPlans })
      .from(installments)
      .innerJoin(installmentPlans, eq(installmentPlans.id, installments.planId))
      .where(and(eq(installments.invoiceId, invoiceId), eq(installments.status, 'scheduled')))
      .orderBy(asc(installments.dueDate));
    const projected = projectedForPeriod(row!, card, rules, now);

    const items = [
      ...posted.map((t) => ({
        kind: t.type === 'transfer' ? ('payment' as const) : ('transaction' as const),
        id: t.id,
        date: t.date,
        description: t.description,
        amount: normalizeMoney(fromCents(-toCents(normalizeMoney(t.amount)))),
        categoryId: t.categoryId,
        status: t.status,
      })),
      ...scheduled.map(({ inst, plan }) => ({
        kind: 'scheduled_installment' as const,
        id: inst.id,
        date: inst.dueDate,
        description: `${plan.description} (${inst.number}/${plan.installmentCount})`,
        amount: normalizeMoney(inst.amount),
        categoryId: plan.categoryId,
        status: 'scheduled',
      })),
      ...projected.map((p) => ({
        kind: 'projected_recurring' as const,
        id: null,
        date: p.date,
        description: p.recurring.description,
        amount: fromCents(-p.amountCents),
        categoryId: p.recurring.categoryId,
        status: 'projected',
      })),
    ].sort((a, b) => a.date.localeCompare(b.date));

    return { ...summary, cardId: card.id, items };
  }

  /** Paga a fatura: transferência da conta pagadora para a conta do cartão, vinculada à fatura. */
  async payInvoice(userId: string, cardId: string, year: number, month: number, input: PayInvoiceBody) {
    const { card } = await this.findOwned(this.db, userId, cardId);
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const invoiceId = await ensureInvoice(this.db, card.id, periodFromDueMonth(key, card));
    const amounts = (await invoiceAmounts(this.db, [invoiceId])).get(invoiceId)!;

    const fromAccountId = input.fromAccountId ?? card.paymentAccountId;
    if (!fromAccountId) throw businessRule('Informe fromAccountId ou defina a conta pagadora do cartão');

    const remaining = amounts.totalCents - amounts.paidCents - amounts.pendingPaymentCents;
    const amount = input.amount ?? (remaining > 0n ? fromCents(remaining) : null);
    if (!amount) throw businessRule('Esta fatura não tem valor a pagar');

    await new TransactionsService(this.db).createTransfer(userId, {
      fromAccountId,
      toAccountId: card.accountId,
      amount,
      date: input.date,
      description: `Pagamento fatura ${String(month).padStart(2, '0')}/${year}`,
      status: input.status,
      allowDuplicate: true,
      invoiceId,
    });
    return this.invoiceDetail(userId, cardId, year, month);
  }

  // ─── internos ──────────────────────────────────────────────────────────────

  private async findOwned(db: DbExecutor, userId: string, id: string): Promise<CardWithAccount> {
    const [row] = await db
      .select({ card: creditCards, account: accounts })
      .from(creditCards)
      .innerJoin(accounts, eq(accounts.id, creditCards.accountId))
      .where(and(eq(creditCards.id, id), eq(creditCards.userId, userId)));
    if (!row) throw notFound('Cartão');
    return row;
  }

  private async toResponse({ card, account }: CardWithAccount, rules: RecurringRow[]): Promise<CreditCardResponse> {
    const now = today();
    const [ledger] = await this.db
      .select({ sum: sql<string>`coalesce(sum(${transactions.amount}), 0)` })
      .from(transactions)
      .where(and(eq(transactions.accountId, account.id), sql`${transactions.status} <> 'cancelled'`));
    const [sched] = await this.db
      .select({ sum: sql<string>`coalesce(sum(${installments.amount}), 0)` })
      .from(installments)
      .innerJoin(installmentPlans, eq(installmentPlans.id, installments.planId))
      .where(and(eq(installmentPlans.accountId, account.id), eq(installments.status, 'scheduled')));

    // Saldo do cartão é negativo quando há dívida. Parcelas futuras também consomem limite.
    const balance = toCents(normalizeMoney(account.initialBalance)) + toCents(normalizeMoney(ledger!.sum));
    const usedCents = -balance + toCents(normalizeMoney(sched!.sum));
    const used = usedCents > 0n ? usedCents : 0n;
    const limit = toCents(normalizeMoney(card.creditLimit));

    const cardRules = rules.filter((r) => r.accountId === account.id);
    const rows = await this.db
      .select()
      .from(invoices)
      .where(eq(invoices.creditCardId, card.id))
      .orderBy(asc(invoices.year), asc(invoices.month));
    const amounts = await invoiceAmounts(this.db, rows.map((r) => r.id));
    const summaries = rows.map((r) => withProjection(summarizeInvoice(r, amounts.get(r.id)!, now), r, card, cardRules, now));
    const currentKey = invoicePeriodForDate(now, card).key;
    const currentInvoice = summaries.find((s) => s.key === currentKey) ?? null;
    const nextDueInvoice =
      summaries.find((s) => (s.status === 'closed' || s.status === 'overdue') && toCents(s.remaining) > 0n) ??
      currentInvoice;

    return {
      id: card.id,
      accountId: account.id,
      name: account.name,
      color: account.color,
      isActive: account.isActive,
      creditLimit: fromCents(limit),
      usedLimit: fromCents(used),
      availableLimit: fromCents(limit - used),
      closingDay: card.closingDay,
      dueDay: card.dueDay,
      paymentAccountId: card.paymentAccountId,
      currentInvoice,
      nextDueInvoice,
    };
  }
}

/** Recorrências do cartão que cairão nesta fatura e ainda não foram lançadas. */
export function projectedForPeriod(row: InvoiceRow, card: CreditCardRow, rules: RecurringRow[], now: string) {
  const period: InvoicePeriod = periodFromDueMonth(`${row.year}-${String(row.month).padStart(2, '0')}`, card);
  const previous = shiftPeriod(period, -1, card);
  // Compras em [fechamento anterior, fechamento atual) caem nesta fatura.
  const from = maxDate(previous.closingDate, addDays(now, 1));
  const to = addDays(row.closingDate, -1);
  if (from > to) return [];
  return projectOccurrences(rules, from, to);
}

function withProjection(
  summary: ReturnType<typeof summarizeInvoice>,
  row: InvoiceRow,
  card: CreditCardRow,
  rules: RecurringRow[],
  now: string,
): InvoiceSummaryResponse {
  const projected = projectedForPeriod(row, card, rules, now).reduce((a, p) => a - p.amountCents, 0n);
  return { ...summary, projectedRecurring: fromCents(projected) };
}
