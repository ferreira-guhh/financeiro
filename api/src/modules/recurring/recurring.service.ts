import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import type { Database, DbExecutor } from '../../db/client.js';
import { accounts, recurringTransactions, transactions } from '../../db/schema.js';
import { addDays, addMonthsToKey, diffDays, maxDate, minDate, monthEnd, monthKey, parseDate, type ISODate } from '../../domain/dates.js';
import { monthlyEquivalentCents, nextOccurrence, occurrencesBetween, type RecurrenceRule } from '../../domain/recurrence.js';
import { today } from '../../lib/clock.js';
import { normalizeDescription } from '../../lib/fingerprint.js';
import { fromCents, normalizeMoney, toCents } from '../../lib/money.js';
import { businessRule, notFound } from '../../shared/errors.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { CategoriesService } from '../categories/categories.service.js';
import { postEntry } from '../ledger/posting.js';
import type { CreateRecurringBody, RecurringResponse, UpcomingItem, UpdateRecurringBody } from './recurring.schemas.js';

export type RecurringRow = typeof recurringTransactions.$inferSelect;

export const toRule = (r: RecurringRow): RecurrenceRule => ({
  frequency: r.frequency,
  interval: r.interval,
  dayOfMonth: r.dayOfMonth,
  startDate: r.startDate,
  endDate: r.endDate,
});

export interface ProjectedOccurrence {
  recurring: RecurringRow;
  date: ISODate;
  /** Assinado. */
  amountCents: bigint;
}

/**
 * Ocorrências FUTURAS (ainda não materializadas) de modelos recorrentes ativos em [from, to].
 * As já geradas (≤ lastGeneratedDate) são excluídas — elas já estão no livro-caixa.
 */
export function projectOccurrences(rules: RecurringRow[], from: ISODate, to: ISODate): ProjectedOccurrence[] {
  const result: ProjectedOccurrence[] = [];
  for (const r of rules) {
    if (!r.isActive) continue;
    const lower = r.lastGeneratedDate ? maxDate(from, addDays(r.lastGeneratedDate, 1)) : from;
    const abs = toCents(normalizeMoney(r.amount));
    for (const date of occurrencesBetween(toRule(r), lower, to)) {
      result.push({ recurring: r, date, amountCents: r.type === 'expense' ? -abs : abs });
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date));
}

/** Todas as ocorrências (geradas ou não) num intervalo — base do orçamento mensal. */
export function allOccurrences(rules: RecurringRow[], from: ISODate, to: ISODate): ProjectedOccurrence[] {
  return rules
    .filter((r) => r.isActive)
    .flatMap((r) => {
      const abs = toCents(normalizeMoney(r.amount));
      return occurrencesBetween(toRule(r), from, to).map((date) => ({
        recurring: r,
        date,
        amountCents: r.type === 'expense' ? -abs : abs,
      }));
    });
}

export class RecurringService {
  constructor(private readonly db: Database) {}

  static async activeRules(db: DbExecutor, userId: string): Promise<RecurringRow[]> {
    return db
      .select()
      .from(recurringTransactions)
      .where(and(eq(recurringTransactions.userId, userId), eq(recurringTransactions.isActive, true)));
  }

  async create(userId: string, input: CreateRecurringBody): Promise<RecurringResponse> {
    await AccountsService.requireActiveAccount(this.db, userId, input.accountId);
    if (input.categoryId) {
      await CategoriesService.requireUsableCategory(this.db, userId, input.categoryId, input.type);
    }
    const dayOfMonth = input.frequency === 'weekly' ? null : (input.dayOfMonth ?? parseDate(input.startDate)[2]);
    const now = today();
    if (input.backfill && input.startDate < `${addMonthsToKey(monthKey(now), -24)}-01`) {
      throw businessRule('Retroativo limitado a 24 meses');
    }

    // Sem retroativo antes do mês atual: um salário "desde 2020" não gera 70 lançamentos pendentes.
    const currentMonthStart = `${monthKey(now)}-01`;
    const lastGeneratedDate = !input.backfill && input.startDate < currentMonthStart ? addDays(currentMonthStart, -1) : null;

    const [row] = await this.db
      .insert(recurringTransactions)
      .values({
        userId,
        accountId: input.accountId,
        categoryId: input.categoryId ?? null,
        type: input.type,
        amount: normalizeMoney(input.amount),
        description: input.description,
        paymentMethod: input.paymentMethod ?? null,
        frequency: input.frequency,
        interval: input.interval,
        dayOfMonth,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        autoConfirm: input.autoConfirm,
        lastGeneratedDate,
      })
      .returning();

    // Com backfill, o que já passou entra como realizado (é histórico, não conta a pagar).
    await this.db.transaction((tx) => RecurringService.materializeRule(tx, row!.id, now, input.backfill ? now : undefined));
    return this.get(userId, row!.id);
  }

  async list(userId: string, includeInactive: boolean) {
    const rows = await this.db
      .select({ r: recurringTransactions, accountName: accounts.name, accountType: accounts.type })
      .from(recurringTransactions)
      .innerJoin(accounts, eq(accounts.id, recurringTransactions.accountId))
      .where(
        and(
          eq(recurringTransactions.userId, userId),
          includeInactive ? undefined : eq(recurringTransactions.isActive, true),
        ),
      )
      .orderBy(asc(recurringTransactions.type), asc(recurringTransactions.description));
    const now = today();
    return rows.map((x) => toResponse(x.r, x.accountName, x.accountType, now));
  }

  async get(userId: string, id: string): Promise<RecurringResponse> {
    const [x] = await this.db
      .select({ r: recurringTransactions, accountName: accounts.name, accountType: accounts.type })
      .from(recurringTransactions)
      .innerJoin(accounts, eq(accounts.id, recurringTransactions.accountId))
      .where(and(eq(recurringTransactions.id, id), eq(recurringTransactions.userId, userId)));
    if (!x) throw notFound('Recorrência');
    return toResponse(x.r, x.accountName, x.accountType, today());
  }

  async update(userId: string, id: string, input: UpdateRecurringBody) {
    const current = await this.get(userId, id);
    if (input.categoryId) {
      await CategoriesService.requireUsableCategory(this.db, userId, input.categoryId, current.type);
    }
    await this.db
      .update(recurringTransactions)
      .set({
        ...input,
        ...(input.amount && { amount: normalizeMoney(input.amount) }),
      })
      .where(and(eq(recurringTransactions.id, id), eq(recurringTransactions.userId, userId)));
    return this.get(userId, id);
  }

  /** Desativa (lançamentos já gerados permanecem no livro-caixa). */
  async deactivate(userId: string, id: string) {
    await this.get(userId, id);
    await this.db
      .update(recurringTransactions)
      .set({ isActive: false })
      .where(and(eq(recurringTransactions.id, id), eq(recurringTransactions.userId, userId)));
  }

  // ─── Materialização ────────────────────────────────────────────────────────

  /**
   * Gera no livro-caixa as ocorrências com data ≤ asOf. Idempotente:
   * trava o modelo (FOR UPDATE), pula datas já geradas e a constraint
   * (recurring_transaction_id, recurrence_date) impede duplicidade.
   */
  static async materializeRule(tx: DbExecutor, id: string, asOf: string, completedBefore?: string): Promise<number> {
    const [rule] = await tx.select().from(recurringTransactions).where(eq(recurringTransactions.id, id)).for('update');
    if (!rule || !rule.isActive) return 0;

    const from = rule.lastGeneratedDate ? addDays(rule.lastGeneratedDate, 1) : rule.startDate;
    const to = rule.endDate ? minDate(asOf, rule.endDate) : asOf;
    if (from > to) return 0;

    const [account] = await tx.select().from(accounts).where(eq(accounts.id, rule.accountId));
    if (!account?.isActive) return 0;

    const dates = occurrencesBetween(toRule(rule), from, to);
    const existing = dates.length
      ? await tx
          .select({ d: transactions.recurrenceDate })
          .from(transactions)
          .where(and(eq(transactions.recurringTransactionId, id), inArray(transactions.recurrenceDate, dates)))
      : [];
    const done = new Set(existing.map((e) => e.d));

    let created = 0;
    for (const date of dates) {
      if (done.has(date)) continue;
      await postEntry(tx, {
        userId: rule.userId,
        account,
        type: rule.type,
        amount: normalizeMoney(rule.amount),
        date,
        description: rule.description,
        categoryId: rule.categoryId,
        status: rule.autoConfirm || (completedBefore && date < completedBefore) ? 'completed' : 'pending',
        paymentMethod: rule.paymentMethod,
        source: 'recurring',
        recurringTransactionId: rule.id,
        recurrenceDate: date,
        allowDuplicate: true,
      });
      created++;
    }
    await tx.update(recurringTransactions).set({ lastGeneratedDate: to }).where(eq(recurringTransactions.id, id));
    return created;
  }

  static async materializeDueForUser(db: Database, userId: string, asOf: string): Promise<number> {
    const rules = await RecurringService.activeRules(db, userId);
    let created = 0;
    for (const r of rules) {
      if (r.lastGeneratedDate && r.lastGeneratedDate >= asOf) continue;
      created += await db.transaction((tx) => RecurringService.materializeRule(tx, r.id, asOf));
    }
    return created;
  }

  // ─── Contas a pagar / receber ──────────────────────────────────────────────

  /** Pendentes já lançados (inclusive atrasados) + ocorrências projetadas nos próximos N dias. */
  async upcoming(userId: string, days: number): Promise<UpcomingItem[]> {
    const now = today();
    const until = addDays(now, days);

    const pending = await this.db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.status, 'pending'),
          lte(transactions.date, until),
          sql`${transactions.type} <> 'transfer'`,
        ),
      )
      .orderBy(asc(transactions.date));

    const rules = await RecurringService.activeRules(this.db, userId);
    const projected = projectOccurrences(rules, addDays(now, 1), until);

    const items: UpcomingItem[] = [
      ...pending.map((t) => ({
        date: t.date,
        description: t.description,
        amount: normalizeMoney(t.amount),
        accountId: t.accountId,
        categoryId: t.categoryId,
        recurringTransactionId: t.recurringTransactionId,
        kind: 'pending' as const,
        transactionId: t.id,
        overdue: t.date < now,
      })),
      ...projected.map((p) => ({
        date: p.date,
        description: p.recurring.description,
        amount: fromCents(p.amountCents),
        accountId: p.recurring.accountId,
        categoryId: p.recurring.categoryId,
        recurringTransactionId: p.recurring.id,
        kind: 'projected' as const,
        transactionId: null,
        overdue: false,
      })),
    ];
    return items.sort((a, b) => a.date.localeCompare(b.date));
  }

  // ─── Identificação de recorrências no histórico ────────────────────────────

  /**
   * Detecta séries mensais no histórico (determinístico, sem IA):
   * mesma conta + mesma "chave" de descrição + mesmo tipo, ≥ 3 ocorrências em meses distintos,
   * intervalos entre 25 e 35 dias e variação de valor ≤ 15%.
   */
  async suggestions(userId: string) {
    const since = `${addMonthsToKey(monthKey(today()), -6)}-01`;
    const rows = await this.db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.status, 'completed'),
          gte(transactions.date, since),
          isNull(transactions.recurringTransactionId),
          sql`${transactions.type} in ('income', 'expense')`,
          sql`${transactions.source} <> 'installment'`,
        ),
      )
      .orderBy(asc(transactions.date));

    const existing = await RecurringService.activeRules(this.db, userId);
    const existingKeys = new Set(existing.map((r) => `${r.accountId}|${merchantKey(r.description)}`));

    const groups = new Map<string, typeof rows>();
    for (const t of rows) {
      const key = `${t.accountId}|${t.type}|${merchantKey(t.rawDescription)}`;
      const list = groups.get(key) ?? [];
      list.push(t);
      groups.set(key, list);
    }

    const suggestions = [];
    for (const [key, list] of groups) {
      if (list.length < 3) continue;
      const months = new Set(list.map((t) => monthKey(t.date)));
      if (months.size < 3) continue;
      const gaps = list.slice(1).map((t, i) => diffDays(list[i]!.date, t.date));
      if (!gaps.every((g) => g >= 25 && g <= 35)) continue;

      const amounts = list.map((t) => abs(toCents(normalizeMoney(t.amount)))).sort((a, b) => (a < b ? -1 : 1));
      const min = amounts[0]!;
      const max = amounts.at(-1)!;
      const median = amounts[Math.floor(amounts.length / 2)]!;
      const variation = median === 0n ? 0n : ((max - min) * 10000n) / median;
      if (variation > 1500n) continue;

      const [accountId, type] = key.split('|') as [string, 'income' | 'expense'];
      if (existingKeys.has(`${accountId}|${merchantKey(list[0]!.rawDescription)}`)) continue;

      const days = list.map((t) => parseDate(t.date)[2]);
      const last = list.at(-1)!;
      suggestions.push({
        description: last.description,
        accountId,
        categoryId: mostCommon(list.map((t) => t.categoryId)),
        type,
        amount: fromCents(median),
        dayOfMonth: mostCommon(days) ?? days.at(-1)!,
        occurrences: list.length,
        lastDate: last.date,
        amountVariationPercent: (Number(variation) / 100).toFixed(2),
      });
    }
    return suggestions.sort((a, b) => b.occurrences - a.occurrences);
  }

  /** Recorrências geradas pendentes num mês (contas do mês ainda não confirmadas). */
  static async pendingRecurringInMonth(db: DbExecutor, userId: string, month: string) {
    return db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.status, 'pending'),
          isNotNull(transactions.recurringTransactionId),
          gte(transactions.date, `${month}-01`),
          lte(transactions.date, monthEnd(month)),
        ),
      );
  }
}

/** "PAGTO NETFLIX.COM 12/03 #4521" → "PAGTO NETFLIX.COM" — ignora números que variam. */
export function merchantKey(description: string): string {
  return normalizeDescription(description)
    .replace(/[0-9]+([./-][0-9]+)*/g, ' ')
    .replace(/[#*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const abs = (v: bigint) => (v < 0n ? -v : v);

function mostCommon<T>(values: T[]): T | null {
  const counts = new Map<T, number>();
  let best: T | null = null;
  let bestCount = 0;
  for (const v of values) {
    if (v === null) continue;
    const c = (counts.get(v) ?? 0) + 1;
    counts.set(v, c);
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

function toResponse(r: RecurringRow, accountName: string, accountType: string, now: string): RecurringResponse {
  const from = r.lastGeneratedDate ? addDays(r.lastGeneratedDate, 1) : maxDate(r.startDate, now);
  return {
    id: r.id,
    accountId: r.accountId,
    accountName,
    accountType,
    categoryId: r.categoryId,
    type: r.type,
    amount: normalizeMoney(r.amount),
    description: r.description,
    paymentMethod: r.paymentMethod,
    frequency: r.frequency,
    interval: r.interval,
    dayOfMonth: r.dayOfMonth,
    startDate: r.startDate,
    endDate: r.endDate,
    lastGeneratedDate: r.lastGeneratedDate,
    autoConfirm: r.autoConfirm,
    isActive: r.isActive,
    nextOccurrence: r.isActive ? nextOccurrence(toRule(r), from) : null,
    monthlyEquivalent: fromCents(monthlyEquivalentCents(toCents(normalizeMoney(r.amount)), r.frequency, r.interval)),
  };
}
