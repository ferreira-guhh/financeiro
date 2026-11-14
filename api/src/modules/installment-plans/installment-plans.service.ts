import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import type { Database, DbExecutor } from '../../db/client.js';
import { accounts, installmentPlans, installments, invoices, transactions } from '../../db/schema.js';
import { invoicePeriodForDate, shiftPeriod } from '../../domain/credit-card.js';
import { addMonthsToKey, monthEnd, monthKey, monthRange } from '../../domain/dates.js';
import { buildInstallmentSchedule, splitInstallments } from '../../domain/installments.js';
import { today } from '../../lib/clock.js';
import { fromCents, normalizeMoney, toCents } from '../../lib/money.js';
import { businessRule, notFound } from '../../shared/errors.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { CategoriesService } from '../categories/categories.service.js';
import { ensureInvoice, getCardByAccount, postEntry, type AccountRow } from '../ledger/posting.js';
import type { InstallmentPlanResponse } from './installment-plans.schemas.js';

type PlanRow = typeof installmentPlans.$inferSelect;
type InstallmentRow = typeof installments.$inferSelect;

export interface CreatePlanInput {
  userId: string;
  account: AccountRow;
  description: string;
  categoryId?: string;
  purchaseDate: string;
  installmentCount: number;
  totalAmount?: string;
  installmentAmount?: string;
}

export class InstallmentPlansService {
  constructor(private readonly db: Database) {}

  /**
   * Cria o plano mestre + as N parcelas (agendadas). Apenas as parcelas cuja data já chegou
   * viram transações reais; as futuras continuam virtuais (projeções).
   */
  static async createPlan(tx: DbExecutor, input: CreatePlanInput): Promise<string> {
    if (input.categoryId) {
      await CategoriesService.requireUsableCategory(tx, input.userId, input.categoryId, 'expense');
    }
    const amounts = input.totalAmount
      ? safeSplit(toCents(input.totalAmount), input.installmentCount)
      : Array.from({ length: input.installmentCount }, () => toCents(input.installmentAmount!));
    const total = amounts.reduce((a, b) => a + b, 0n);
    const schedule = buildInstallmentSchedule(input.purchaseDate, amounts);

    const [plan] = await tx
      .insert(installmentPlans)
      .values({
        userId: input.userId,
        accountId: input.account.id,
        categoryId: input.categoryId ?? null,
        description: input.description,
        totalAmount: fromCents(total),
        installmentCount: input.installmentCount,
        purchaseDate: input.purchaseDate,
      })
      .returning();

    // Cartão: parcela k vai para a fatura (primeira + k−1), independente de ajustes de dia.
    let invoiceIds: (string | null)[] = schedule.map(() => null);
    if (input.account.type === 'credit_card') {
      const card = await getCardByAccount(tx, input.account.id);
      const first = invoicePeriodForDate(input.purchaseDate, card);
      invoiceIds = [];
      for (let k = 0; k < schedule.length; k++) {
        invoiceIds.push(await ensureInvoice(tx, card.id, shiftPeriod(first, k, card)));
      }
    }

    await tx.insert(installments).values(
      schedule.map((s, i) => ({
        planId: plan!.id,
        number: s.number,
        amount: fromCents(s.amountCents),
        dueDate: s.date,
        invoiceId: invoiceIds[i] ?? null,
      })),
    );

    await InstallmentPlansService.materializePlan(tx, plan!.id, today());
    return plan!.id;
  }

  /** Lança no livro-caixa as parcelas agendadas com data ≤ asOf. Idempotente (trava o plano). */
  static async materializePlan(tx: DbExecutor, planId: string, asOf: string): Promise<number> {
    const [plan] = await tx.select().from(installmentPlans).where(eq(installmentPlans.id, planId)).for('update');
    if (!plan || plan.status !== 'active') return 0;

    const due = await tx
      .select()
      .from(installments)
      .where(and(eq(installments.planId, planId), eq(installments.status, 'scheduled'), lte(installments.dueDate, asOf)))
      .orderBy(asc(installments.number));
    if (due.length === 0) return 0;

    const [account] = await tx.select().from(accounts).where(eq(accounts.id, plan.accountId));
    for (const inst of due) {
      const label = `${plan.description} (${inst.number}/${plan.installmentCount})`;
      const row = await postEntry(tx, {
        userId: plan.userId,
        account: account!,
        type: 'expense',
        amount: normalizeMoney(inst.amount),
        date: inst.dueDate,
        description: label,
        categoryId: plan.categoryId,
        // No cartão a dívida existe ao lançar; em carnê/boleto, fica pendente até pagar.
        status: account!.type === 'credit_card' ? 'completed' : 'pending',
        source: 'installment',
        invoiceId: inst.invoiceId,
        allowDuplicate: true,
      });
      await tx
        .update(installments)
        .set({ status: 'posted', transactionId: row.id })
        .where(eq(installments.id, inst.id));
    }

    const [{ remaining } = { remaining: 0 }] = await tx
      .select({ remaining: sql<number>`count(*)::int` })
      .from(installments)
      .where(and(eq(installments.planId, planId), eq(installments.status, 'scheduled')));
    if (remaining === 0) {
      await tx.update(installmentPlans).set({ status: 'completed' }).where(eq(installmentPlans.id, planId));
    }
    return due.length;
  }

  static async materializeDueForUser(db: Database, userId: string, asOf: string): Promise<number> {
    const plans = await db
      .selectDistinct({ id: installmentPlans.id })
      .from(installmentPlans)
      .innerJoin(installments, eq(installments.planId, installmentPlans.id))
      .where(
        and(
          eq(installmentPlans.userId, userId),
          eq(installmentPlans.status, 'active'),
          eq(installments.status, 'scheduled'),
          lte(installments.dueDate, asOf),
        ),
      );
    let posted = 0;
    for (const { id } of plans) {
      posted += await db.transaction((tx) => InstallmentPlansService.materializePlan(tx, id, asOf));
    }
    return posted;
  }

  // ─── API ───────────────────────────────────────────────────────────────────

  async create(userId: string, input: Omit<CreatePlanInput, 'userId' | 'account'> & { accountId: string }) {
    const id = await this.db.transaction(async (tx) => {
      const account = await AccountsService.requireActiveAccount(tx, userId, input.accountId);
      return InstallmentPlansService.createPlan(tx, { ...input, userId, account });
    });
    return this.get(userId, id);
  }

  async list(userId: string, filter: { status?: PlanRow['status']; accountId?: string }) {
    const plans = await this.db
      .select({ plan: installmentPlans, accountName: accounts.name, accountType: accounts.type })
      .from(installmentPlans)
      .innerJoin(accounts, eq(accounts.id, installmentPlans.accountId))
      .where(
        and(
          eq(installmentPlans.userId, userId),
          filter.status ? eq(installmentPlans.status, filter.status) : undefined,
          filter.accountId ? eq(installmentPlans.accountId, filter.accountId) : undefined,
        ),
      )
      .orderBy(desc(installmentPlans.purchaseDate), desc(installmentPlans.createdAt));
    const rows = await this.installmentsOf(plans.map((p) => p.plan.id));
    return plans.map((p) => toPlanResponse(p.plan, p.accountName, p.accountType, rows.get(p.plan.id) ?? [], false));
  }

  async get(userId: string, id: string): Promise<InstallmentPlanResponse> {
    const [p] = await this.db
      .select({ plan: installmentPlans, accountName: accounts.name, accountType: accounts.type })
      .from(installmentPlans)
      .innerJoin(accounts, eq(accounts.id, installmentPlans.accountId))
      .where(and(eq(installmentPlans.id, id), eq(installmentPlans.userId, userId)));
    if (!p) throw notFound('Parcelamento');
    const rows = await this.installmentsOf([id]);
    return toPlanResponse(p.plan, p.accountName, p.accountType, rows.get(id) ?? [], true);
  }

  /** Cancela parcelas futuras; opcionalmente as já lançadas cujas faturas seguem abertas. */
  async cancel(userId: string, id: string, cancelPosted: boolean) {
    await this.db.transaction(async (tx) => {
      const [plan] = await tx
        .select()
        .from(installmentPlans)
        .where(and(eq(installmentPlans.id, id), eq(installmentPlans.userId, userId)))
        .for('update');
      if (!plan) throw notFound('Parcelamento');
      if (plan.status === 'cancelled') return;

      await tx
        .update(installments)
        .set({ status: 'cancelled' })
        .where(and(eq(installments.planId, id), eq(installments.status, 'scheduled')));

      if (cancelPosted) {
        const now = today();
        const posted = await tx
          .select({ inst: installments, closing: invoices.closingDate })
          .from(installments)
          .leftJoin(invoices, eq(invoices.id, installments.invoiceId))
          .where(and(eq(installments.planId, id), eq(installments.status, 'posted')));
        const cancellable = posted.filter((p) => !p.closing || now < p.closing);
        const txIds = cancellable.map((p) => p.inst.transactionId!).filter(Boolean);
        if (txIds.length) {
          await tx.update(transactions).set({ status: 'cancelled' }).where(inArray(transactions.id, txIds));
          await tx
            .update(installments)
            .set({ status: 'cancelled' })
            .where(inArray(installments.id, cancellable.map((p) => p.inst.id)));
        }
      }
      await tx.update(installmentPlans).set({ status: 'cancelled' }).where(eq(installmentPlans.id, id));
    });
  }

  /** Compromissos futuros: total de parcelas por mês (para previsão e comprometimento de renda). */
  async schedule(userId: string, months: number) {
    const start = monthKey(today());
    const end = addMonthsToKey(start, months - 1);
    const rows = await InstallmentPlansService.monthlyTotals(this.db, userId, start, end);
    const list = monthRange(start, end).map((m) => {
      const r = rows.get(m);
      return {
        month: m,
        total: fromCents(r?.total ?? 0n),
        count: r?.count ?? 0,
        cardTotal: fromCents(r?.card ?? 0n),
      };
    });
    const totalCommitted = list.reduce((a, m) => a + toCents(m.total), 0n);
    return { months: list, totalCommitted: fromCents(totalCommitted) };
  }

  /** Soma das parcelas (lançadas ou agendadas) por mês de competência. */
  static async monthlyTotals(db: DbExecutor, userId: string, fromMonth: string, toMonth: string) {
    const result = await db
      .select({
        month: sql<string>`to_char(${installments.dueDate}, 'YYYY-MM')`,
        total: sql<string>`sum(${installments.amount})`,
        card: sql<string>`coalesce(sum(${installments.amount}) filter (where ${accounts.type} = 'credit_card'), 0)`,
        count: sql<number>`count(*)::int`,
      })
      .from(installments)
      .innerJoin(installmentPlans, eq(installmentPlans.id, installments.planId))
      .innerJoin(accounts, eq(accounts.id, installmentPlans.accountId))
      .where(
        and(
          eq(installmentPlans.userId, userId),
          ne(installments.status, 'cancelled'),
          gte(installments.dueDate, `${fromMonth}-01`),
          lte(installments.dueDate, monthEnd(toMonth)),
        ),
      )
      .groupBy(sql`1`);
    return new Map(
      result.map((r) => [
        r.month,
        { total: toCents(normalizeMoney(r.total)), card: toCents(normalizeMoney(r.card)), count: r.count },
      ]),
    );
  }

  private async installmentsOf(planIds: string[]) {
    const map = new Map<string, (InstallmentRow & { invoiceKey: string | null })[]>();
    if (planIds.length === 0) return map;
    const rows = await this.db
      .select({ inst: installments, year: invoices.year, month: invoices.month })
      .from(installments)
      .leftJoin(invoices, eq(invoices.id, installments.invoiceId))
      .where(inArray(installments.planId, planIds))
      .orderBy(asc(installments.number));
    for (const r of rows) {
      const list = map.get(r.inst.planId) ?? [];
      list.push({ ...r.inst, invoiceKey: r.year ? `${r.year}-${String(r.month).padStart(2, '0')}` : null });
      map.set(r.inst.planId, list);
    }
    return map;
  }
}

function safeSplit(total: bigint, count: number) {
  try {
    return splitInstallments(total, count);
  } catch (err) {
    throw businessRule((err as Error).message);
  }
}

function toPlanResponse(
  plan: PlanRow,
  accountName: string,
  accountType: string,
  rows: (InstallmentRow & { invoiceKey: string | null })[],
  withInstallments: boolean,
): InstallmentPlanResponse {
  const active = rows.filter((r) => r.status !== 'cancelled');
  const posted = active.filter((r) => r.status === 'posted');
  const scheduled = active.filter((r) => r.status === 'scheduled');
  const sum = (list: InstallmentRow[]) => fromCents(list.reduce((a, r) => a + toCents(normalizeMoney(r.amount)), 0n));
  return {
    id: plan.id,
    accountId: plan.accountId,
    accountName,
    accountType,
    categoryId: plan.categoryId,
    description: plan.description,
    status: plan.status,
    totalAmount: normalizeMoney(plan.totalAmount),
    installmentCount: plan.installmentCount,
    installmentAmount: normalizeMoney(rows.at(-1)?.amount ?? '0'),
    firstInstallmentAmount: normalizeMoney(rows[0]?.amount ?? '0'),
    purchaseDate: plan.purchaseDate,
    firstDate: rows[0]?.dueDate ?? plan.purchaseDate,
    lastDate: rows.at(-1)?.dueDate ?? plan.purchaseDate,
    currentInstallment: posted.length,
    remainingCount: scheduled.length,
    postedAmount: sum(posted),
    remainingAmount: sum(scheduled),
    nextDate: scheduled[0]?.dueDate ?? null,
    ...(withInstallments && {
      installments: rows.map((r) => ({
        id: r.id,
        number: r.number,
        amount: normalizeMoney(r.amount),
        date: r.dueDate,
        status: r.status,
        invoiceKey: r.invoiceKey,
        transactionId: r.transactionId,
      })),
    }),
  };
}
