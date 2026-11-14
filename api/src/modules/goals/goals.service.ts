import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Database, DbExecutor } from '../../db/client.js';
import { accounts, financialGoals, goalContributions, transactions } from '../../db/schema.js';
import { monthKey, monthsBetween } from '../../domain/dates.js';
import { goalTimeline, requiredMonthlyContribution } from '../../domain/simulation/goals.js';
import { D, money } from '../../domain/simulation/decimal.js';
import { today } from '../../lib/clock.js';
import { fromCents, normalizeMoney, toCents } from '../../lib/money.js';
import { businessRule, notFound } from '../../shared/errors.js';
import { AccountsService } from '../accounts/accounts.service.js';
import type { CreateGoalBody, GoalResponse, UpdateGoalBody } from './goals.schemas.js';

type GoalRow = typeof financialGoals.$inferSelect;

export class GoalsService {
  constructor(private readonly db: Database) {}

  async list(userId: string, includeInactive: boolean): Promise<GoalResponse[]> {
    const rows = await this.db
      .select()
      .from(financialGoals)
      .where(and(eq(financialGoals.userId, userId), includeInactive ? undefined : ne(financialGoals.status, 'cancelled')))
      .orderBy(desc(financialGoals.status), financialGoals.targetDate, financialGoals.name);
    const current = await GoalsService.currentAmounts(this.db, rows);
    return rows.map((g) => toGoalResponse(g, current.get(g.id) ?? 0n));
  }

  async get(userId: string, id: string): Promise<GoalResponse> {
    const goal = await this.findOwned(userId, id);
    const current = await GoalsService.currentAmounts(this.db, [goal]);
    return toGoalResponse(goal, current.get(id) ?? 0n);
  }

  async create(userId: string, input: CreateGoalBody) {
    if (input.linkedAccountId) await AccountsService.requireActiveAccount(this.db, userId, input.linkedAccountId);
    const [row] = await this.db
      .insert(financialGoals)
      .values({
        userId,
        name: input.name,
        kind: input.kind,
        targetAmount: normalizeMoney(input.targetAmount),
        initialAmount: normalizeMoney(input.initialAmount),
        monthlyContribution: input.monthlyContribution ? normalizeMoney(input.monthlyContribution) : null,
        expectedAnnualRate: input.expectedAnnualRate ?? null,
        targetDate: input.targetDate ?? null,
        linkedAccountId: input.linkedAccountId ?? null,
        icon: input.icon ?? null,
        color: input.color ?? null,
      })
      .returning();
    return this.get(userId, row!.id);
  }

  async update(userId: string, id: string, input: UpdateGoalBody) {
    await this.findOwned(userId, id);
    if (input.linkedAccountId) await AccountsService.requireActiveAccount(this.db, userId, input.linkedAccountId);
    await this.db
      .update(financialGoals)
      .set({
        ...input,
        ...(input.targetAmount && { targetAmount: normalizeMoney(input.targetAmount) }),
        ...(input.monthlyContribution && { monthlyContribution: normalizeMoney(input.monthlyContribution) }),
      })
      .where(eq(financialGoals.id, id));
    return this.get(userId, id);
  }

  async cancel(userId: string, id: string) {
    await this.findOwned(userId, id);
    await this.db.update(financialGoals).set({ status: 'cancelled' }).where(eq(financialGoals.id, id));
  }

  async addContribution(userId: string, id: string, input: { amount: string; date: string; note?: string }) {
    const goal = await this.findOwned(userId, id);
    if (goal.linkedAccountId) {
      throw businessRule('Meta vinculada a uma conta: o progresso é o saldo da conta. Faça uma transferência para ela.');
    }
    if (goal.status !== 'active') throw businessRule('Meta não está ativa');
    const current = (await GoalsService.currentAmounts(this.db, [goal])).get(id) ?? 0n;
    if (current + toCents(input.amount) < 0n) throw businessRule('Resgate maior que o valor guardado na meta');

    await this.db.insert(goalContributions).values({
      goalId: id,
      userId,
      amount: normalizeMoney(input.amount),
      date: input.date,
      note: input.note ?? null,
    });
    return this.get(userId, id);
  }

  async listContributions(userId: string, id: string) {
    await this.findOwned(userId, id);
    const rows = await this.db
      .select()
      .from(goalContributions)
      .where(eq(goalContributions.goalId, id))
      .orderBy(desc(goalContributions.date), desc(goalContributions.createdAt));
    return rows.map((r) => ({ id: r.id, amount: normalizeMoney(r.amount), date: r.date, note: r.note }));
  }

  /** Projeção da meta + impacto de aumentar ou diminuir o aporte. */
  async projection(userId: string, id: string, params: { monthlyContribution?: string; annualRate?: string }) {
    const goal = await this.get(userId, id);
    const contribution = params.monthlyContribution ?? goal.monthlyContribution ?? goal.requiredMonthlyContribution ?? '0.00';
    const rate = params.annualRate ?? goal.expectedAnnualRate ?? '0';
    const startMonth = monthKey(today());
    const timeline = goalTimeline({
      targetAmount: goal.targetAmount,
      currentAmount: goal.currentAmount,
      monthlyContribution: contribution,
      annualRatePercent: rate,
      startMonth,
    });

    const base = new D(contribution);
    const alternatives = [
      { label: '−25%', factor: '0.75' },
      { label: 'Atual', factor: '1' },
      { label: '+25%', factor: '1.25' },
      { label: '+50%', factor: '1.5' },
    ].map(({ label, factor }) => {
      const c = money(base.times(factor));
      const t = goalTimeline({ targetAmount: goal.targetAmount, currentAmount: goal.currentAmount, monthlyContribution: c, annualRatePercent: rate, startMonth });
      return { label, monthlyContribution: c, months: t.months, reachedMonth: t.reachedMonth };
    });

    return {
      goal,
      monthlyContribution: normalizeMoney(contribution),
      annualRate: new D(rate).toFixed(2),
      reached: timeline.reached,
      months: timeline.months,
      reachedMonth: timeline.reachedMonth,
      totalContributed: timeline.totalContributed,
      totalInterest: timeline.totalInterest,
      series: timeline.series,
      alternatives,
    };
  }

  /** Soma dos aportes mensais desejados das metas ativas (usada no gasto seguro). */
  static async activeMonthlyContributions(db: DbExecutor, userId: string): Promise<bigint> {
    const [row] = await db
      .select({ total: sql<string>`coalesce(sum(${financialGoals.monthlyContribution}), 0)` })
      .from(financialGoals)
      .where(and(eq(financialGoals.userId, userId), eq(financialGoals.status, 'active')));
    return toCents(normalizeMoney(row!.total));
  }

  /** Valor atual: saldo da conta vinculada, ou valor inicial + aportes. */
  static async currentAmounts(db: DbExecutor, goals: GoalRow[]): Promise<Map<string, bigint>> {
    const result = new Map<string, bigint>();
    const plain = goals.filter((g) => !g.linkedAccountId);
    const linked = goals.filter((g) => g.linkedAccountId);

    if (plain.length) {
      const sums = await db
        .select({ goalId: goalContributions.goalId, total: sql<string>`sum(${goalContributions.amount})` })
        .from(goalContributions)
        .where(inArray(goalContributions.goalId, plain.map((g) => g.id)))
        .groupBy(goalContributions.goalId);
      const byGoal = new Map(sums.map((s) => [s.goalId, toCents(normalizeMoney(s.total))]));
      for (const g of plain) result.set(g.id, toCents(normalizeMoney(g.initialAmount)) + (byGoal.get(g.id) ?? 0n));
    }

    if (linked.length) {
      const ids = [...new Set(linked.map((g) => g.linkedAccountId!))];
      const balances = await db
        .select({
          id: accounts.id,
          balance: sql<string>`${accounts.initialBalance} + coalesce((select sum(${transactions.amount}) from ${transactions} where ${transactions.accountId} = ${accounts.id} and ${transactions.status} = 'completed'), 0)`,
        })
        .from(accounts)
        .where(inArray(accounts.id, ids));
      const byAccount = new Map(balances.map((b) => [b.id, toCents(normalizeMoney(b.balance))]));
      for (const g of linked) result.set(g.id, byAccount.get(g.linkedAccountId!) ?? 0n);
    }
    return result;
  }

  private async findOwned(userId: string, id: string): Promise<GoalRow> {
    const [goal] = await this.db
      .select()
      .from(financialGoals)
      .where(and(eq(financialGoals.id, id), eq(financialGoals.userId, userId)));
    if (!goal) throw notFound('Meta');
    return goal;
  }
}

function toGoalResponse(g: GoalRow, currentCents: bigint): GoalResponse {
  const target = toCents(normalizeMoney(g.targetAmount));
  const current = currentCents > 0n ? currentCents : 0n;
  const remaining = target > current ? target - current : 0n;
  const isReached = current >= target;
  const progress = target === 0n ? 0 : Number((current * 10000n) / target) / 100;
  const rate = g.expectedAnnualRate ?? '0';
  const nowMonth = monthKey(today());

  const monthsLeft = g.targetDate ? Math.max(1, monthsBetween(nowMonth, monthKey(g.targetDate)) + 1) : null;
  const required =
    monthsLeft && !isReached
      ? requiredMonthlyContribution({
          targetAmount: fromCents(target),
          currentAmount: fromCents(current),
          months: monthsLeft,
          annualRatePercent: rate,
        })
      : isReached
        ? '0.00'
        : null;

  let forecastMonth: string | null = isReached ? nowMonth : null;
  if (!isReached && g.monthlyContribution) {
    forecastMonth = goalTimeline({
      targetAmount: fromCents(target),
      currentAmount: fromCents(current),
      monthlyContribution: normalizeMoney(g.monthlyContribution),
      annualRatePercent: rate,
      startMonth: nowMonth,
    }).reachedMonth;
  }

  return {
    id: g.id,
    name: g.name,
    kind: g.kind,
    status: g.status,
    targetAmount: fromCents(target),
    initialAmount: normalizeMoney(g.initialAmount),
    currentAmount: fromCents(current),
    remainingAmount: fromCents(remaining),
    progressPercent: Math.min(progress, 100).toFixed(2),
    monthlyContribution: g.monthlyContribution ? normalizeMoney(g.monthlyContribution) : null,
    expectedAnnualRate: g.expectedAnnualRate ? new D(g.expectedAnnualRate).toFixed(2) : null,
    targetDate: g.targetDate,
    linkedAccountId: g.linkedAccountId,
    icon: g.icon,
    color: g.color,
    isReached,
    monthsLeft,
    requiredMonthlyContribution: required,
    forecastMonth,
    onTrack: g.targetDate && forecastMonth ? forecastMonth <= monthKey(g.targetDate) : g.targetDate && isReached ? true : null,
  };
}
