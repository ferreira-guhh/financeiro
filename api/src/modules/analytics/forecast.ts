/**
 * Previsão de fluxo de caixa das contas de movimento (corrente, poupança, carteira).
 *
 * Eventos considerados, a partir de hoje:
 * 1. Lançamentos pendentes (atrasados entram hoje).
 * 2. Ocorrências futuras de recorrências nessas contas.
 * 3. Parcelas futuras de carnês/boletos (parcelamentos fora do cartão).
 * 4. Faturas de cartão no vencimento: saldo devedor + parcelas agendadas + assinaturas previstas.
 * 5. (Opcional) gasto variável médio dos últimos 3 meses, distribuído por dia.
 */
import { and, asc, eq, gt, lte } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client.js';
import { accounts, creditCards, installmentPlans, installments, invoices, transactions } from '../../db/schema.js';
import { invoicePeriodForDate, shiftPeriod } from '../../domain/credit-card.js';
import { addDays, addMonthsToKey, daysInMonth, diffDays, monthEnd, monthKey, parseMonth } from '../../domain/dates.js';
import { today } from '../../lib/clock.js';
import { fromCents, normalizeMoney, toCents } from '../../lib/money.js';
import { invoiceAmounts } from '../credit-cards/invoice-queries.js';
import { projectedForPeriod } from '../credit-cards/credit-cards.service.js';
import { RecurringService, projectOccurrences } from '../recurring/recurring.service.js';
import { averageVariable3m } from './budget.js';
import { LIQUID_TYPES, balancesAsOf, variableExpense } from './queries.js';

export type ForecastEventKind = 'pending' | 'recurring' | 'installment' | 'invoice' | 'variable';

export interface ForecastEvent {
  date: string;
  description: string;
  amountCents: bigint;
  kind: ForecastEventKind;
}

export interface ForecastOptions {
  months: number;
  includeVariableAverage: boolean;
}

export async function buildForecast(db: DbExecutor, userId: string, opts: ForecastOptions) {
  const now = today();
  const end = monthEnd(addMonthsToKey(monthKey(now), opts.months - 1));
  const events: ForecastEvent[] = [];

  const userAccounts = await db.select().from(accounts).where(eq(accounts.userId, userId));
  const liquidIds = new Set(userAccounts.filter((a) => (LIQUID_TYPES as readonly string[]).includes(a.type)).map((a) => a.id));

  // 1. Pendentes em contas de movimento.
  const pending = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.status, 'pending'), lte(transactions.date, end)));
  for (const t of pending) {
    if (!liquidIds.has(t.accountId)) continue;
    events.push({
      date: t.date < now ? now : t.date,
      description: t.description,
      amountCents: toCents(normalizeMoney(t.amount)),
      kind: 'pending',
    });
  }

  // 2. Recorrências futuras nas contas de movimento.
  const rules = await RecurringService.activeRules(db, userId);
  for (const p of projectOccurrences(rules.filter((r) => liquidIds.has(r.accountId)), addDays(now, 1), end)) {
    events.push({ date: p.date, description: p.recurring.description, amountCents: p.amountCents, kind: 'recurring' });
  }

  // 3. Parcelas agendadas fora do cartão.
  const scheduled = await db
    .select({ inst: installments, plan: installmentPlans })
    .from(installments)
    .innerJoin(installmentPlans, eq(installmentPlans.id, installments.planId))
    .where(
      and(
        eq(installmentPlans.userId, userId),
        eq(installments.status, 'scheduled'),
        gt(installments.dueDate, now),
        lte(installments.dueDate, end),
      ),
    );
  for (const { inst, plan } of scheduled) {
    if (!liquidIds.has(plan.accountId)) continue;
    events.push({
      date: inst.dueDate,
      description: `${plan.description} (${inst.number}/${plan.installmentCount})`,
      amountCents: -toCents(normalizeMoney(inst.amount)),
      kind: 'installment',
    });
  }

  // 4. Faturas de cartão (pagas a partir da conta pagadora).
  const cards = await db
    .select({ card: creditCards, account: accounts })
    .from(creditCards)
    .innerJoin(accounts, eq(accounts.id, creditCards.accountId))
    .where(and(eq(creditCards.userId, userId), eq(accounts.isActive, true)));
  for (const { card, account } of cards) {
    const cardRules = rules.filter((r) => r.accountId === account.id);
    const rows = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.creditCardId, card.id), lte(invoices.dueDate, end)))
      .orderBy(asc(invoices.year), asc(invoices.month));
    const amounts = await invoiceAmounts(db, rows.map((r) => r.id));
    const seen = new Set<string>();
    for (const row of rows) {
      const key = `${row.year}-${String(row.month).padStart(2, '0')}`;
      seen.add(key);
      const a = amounts.get(row.id)!;
      const projected = projectedForPeriod(row, card, cardRules, now).reduce((s, p) => s - p.amountCents, 0n);
      const due = a.totalCents - a.paidCents - a.pendingPaymentCents + projected;
      if (due <= 0n) continue;
      if (row.dueDate < now && a.totalCents <= a.paidCents) continue;
      events.push({
        date: row.dueDate < now ? now : row.dueDate,
        description: `Fatura ${account.name} ${String(row.month).padStart(2, '0')}/${row.year}`,
        amountCents: -due,
        kind: 'invoice',
      });
    }
    // Faturas futuras ainda sem linha no banco: só assinaturas previstas.
    let period = invoicePeriodForDate(now, card);
    while (period.dueDate <= end) {
      if (!seen.has(period.key) && cardRules.length) {
        const fake = { id: '', creditCardId: card.id, year: period.year, month: period.month, closingDate: period.closingDate, dueDate: period.dueDate, createdAt: new Date(), updatedAt: new Date() };
        const projected = projectedForPeriod(fake, card, cardRules, now).reduce((s, p) => s - p.amountCents, 0n);
        if (projected > 0n) {
          events.push({ date: period.dueDate, description: `Fatura ${account.name} ${String(period.month).padStart(2, '0')}/${period.year} (prevista)`, amountCents: -projected, kind: 'invoice' });
        }
      }
      period = shiftPeriod(period, 1, card);
    }
  }

  // 5. Gasto variável médio (opcional).
  if (opts.includeVariableAverage) {
    const avg = await averageVariable3m(db, userId, monthKey(now));
    if (avg > 0n) {
      const currentMonth = monthKey(now);
      const spent = await variableExpense(db, userId, `${currentMonth}-01`, now);
      for (const month of monthsUntil(currentMonth, end)) {
        const [y, m] = parseMonth(month);
        const days = daysInMonth(y, m);
        const isCurrent = month === currentMonth;
        const budget = isCurrent ? (avg > spent ? avg - spent : 0n) : avg;
        const firstDay = isCurrent ? addDays(now, 1) : `${month}-01`;
        const span = isCurrent ? diffDays(now, monthEnd(month)) : days;
        if (span <= 0 || budget === 0n) continue;
        // Distribuição em centavos sem perder resto: o último dia leva a sobra.
        const perDay = budget / BigInt(span);
        const rest = budget - perDay * BigInt(span);
        for (let i = 0; i < span; i++) {
          events.push({
            date: addDays(firstDay, i),
            description: 'Gasto variável médio',
            amountCents: -(perDay + (i === span - 1 ? rest : 0n)),
            kind: 'variable',
          });
        }
      }
    }
  }

  // ─── Série diária ──────────────────────────────────────────────────────────
  const start = (await balancesAsOf(db, userId, now)).liquidCents;
  const byDate = new Map<string, ForecastEvent[]>();
  for (const e of events) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);

  const days: { date: string; balance: string; inflow: string; outflow: string }[] = [];
  const months = new Map<string, { start: bigint; income: bigint; expenses: bigint; invoices: bigint; end: bigint; lowest: bigint; lowestDate: string }>();
  let balance = start;
  let lowest = start;
  let lowestDate = now;
  let firstNegative: string | null = start < 0n ? now : null;

  for (let d = now; d <= end; d = addDays(d, 1)) {
    const month = monthKey(d);
    if (!months.has(month)) {
      months.set(month, { start: balance, income: 0n, expenses: 0n, invoices: 0n, end: balance, lowest: balance, lowestDate: d });
    }
    const m = months.get(month)!;
    let inflow = 0n;
    let outflow = 0n;
    for (const e of byDate.get(d) ?? []) {
      if (e.amountCents >= 0n) inflow += e.amountCents;
      else outflow -= e.amountCents;
      if (e.kind === 'invoice') m.invoices -= e.amountCents;
      else if (e.amountCents >= 0n) m.income += e.amountCents;
      else m.expenses -= e.amountCents;
    }
    balance += inflow - outflow;
    m.end = balance;
    if (balance < m.lowest) {
      m.lowest = balance;
      m.lowestDate = d;
    }
    if (balance < lowest) {
      lowest = balance;
      lowestDate = d;
    }
    if (!firstNegative && balance < 0n) firstNegative = d;
    days.push({ date: d, balance: fromCents(balance), inflow: fromCents(inflow), outflow: fromCents(outflow) });
  }

  return {
    startDate: now,
    endDate: end,
    startBalance: fromCents(start),
    includesVariableAverage: opts.includeVariableAverage,
    days,
    months: [...months.entries()].map(([month, m]) => ({
      month,
      startBalance: fromCents(m.start),
      income: fromCents(m.income),
      expenses: fromCents(m.expenses),
      cardInvoices: fromCents(m.invoices),
      endBalance: fromCents(m.end),
      lowestBalance: fromCents(m.lowest),
      lowestDate: m.lowestDate,
    })),
    events: events
      .filter((e) => e.kind !== 'variable')
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((e) => ({ date: e.date, description: e.description, amount: fromCents(e.amountCents), kind: e.kind })),
    summary: {
      endBalance: fromCents(balance),
      lowestBalance: fromCents(lowest),
      lowestDate,
      firstNegativeDate: firstNegative,
    },
  };
}

function monthsUntil(from: string, endDate: string) {
  const result: string[] = [];
  for (let m = from; m <= monthKey(endDate); m = addMonthsToKey(m, 1)) result.push(m);
  return result;
}
