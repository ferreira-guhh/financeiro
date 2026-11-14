import type { Database } from '../../db/client.js';
import { addDays, addMonthsToKey, diffDays, monthEnd, monthKey, monthRange, weekStart } from '../../domain/dates.js';
import { today } from '../../lib/clock.js';
import { fromCents, toCents } from '../../lib/money.js';
import { CreditCardsService } from '../credit-cards/credit-cards.service.js';
import { GoalsService } from '../goals/goals.service.js';
import { InstallmentPlansService } from '../installment-plans/installment-plans.service.js';
import { RecurringService, allOccurrences } from '../recurring/recurring.service.js';
import { averageVariable3m, safeToSpend } from './budget.js';
import { buildForecast } from './forecast.js';
import {
  balancesAsOf,
  categoryTotals,
  change,
  dailyLiquidBalance,
  monthlyFlows,
  netInvested,
  percent,
  periodFlows,
  topExpenses,
  unlinkedInvestmentsValue,
  type CategoryTotal,
} from './queries.js';

const serializeCategory = (c: CategoryTotal, total: bigint) => ({
  categoryId: c.categoryId,
  name: c.name,
  color: c.color,
  icon: c.icon,
  isEssential: c.isEssential,
  total: fromCents(c.totalCents),
  count: c.count,
  share: percent(c.totalCents, total),
});

export class AnalyticsService {
  constructor(private readonly db: Database) {}

  // ─── Dashboard ─────────────────────────────────────────────────────────────

  async dashboard(userId: string, month?: string) {
    const now = today();
    const m = month ?? monthKey(now);
    const start = `${m}-01`;
    const end = monthEnd(m);

    const [balances, unlinked, flows, safe, upcoming, schedule, cards, goals, forecast] = await Promise.all([
      balancesAsOf(this.db, userId, now),
      unlinkedInvestmentsValue(this.db, userId),
      periodFlows(this.db, userId, start, end),
      safeToSpend(this.db, userId, m),
      new RecurringService(this.db).upcoming(userId, 30),
      new InstallmentPlansService(this.db).schedule(userId, 6),
      new CreditCardsService(this.db).list(userId),
      new GoalsService(this.db).list(userId, false),
      buildForecast(this.db, userId, { months: 1, includeVariableAverage: false }),
    ]);

    const net = flows.incomeCents - flows.expenseCents;
    const investments = balances.investmentAccountsCents + unlinked;
    const upcomingOut = upcoming.filter((u) => toCents(u.amount) < 0n);

    return {
      month: m,
      today: now,
      balances: {
        /** Contas de movimento (corrente, poupança, carteira). */
        current: fromCents(balances.liquidCents),
        investments: fromCents(investments),
        creditCardDebt: fromCents(balances.cardDebtCents),
        netWorth: fromCents(balances.netWorthCents + unlinked),
      },
      monthSummary: {
        income: fromCents(flows.incomeCents),
        expenses: fromCents(flows.expenseCents),
        net: fromCents(net),
        savingsRate: percent(net, flows.incomeCents),
      },
      /** Saldo previsto no fim do mês após contas, recorrências e faturas a vencer. */
      available: {
        amount: forecast.months.at(-1)?.endBalance ?? fromCents(balances.liquidCents),
        lowestBalance: forecast.summary.lowestBalance,
        lowestDate: forecast.summary.lowestDate,
      },
      upcomingBills: {
        total: fromCents(upcomingOut.reduce((a, u) => a - toCents(u.amount), 0n)),
        overdueCount: upcoming.filter((u) => u.overdue).length,
        items: upcoming.slice(0, 10),
      },
      upcomingInstallments: schedule,
      creditCards: cards.map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        availableLimit: c.availableLimit,
        creditLimit: c.creditLimit,
        currentInvoice: c.currentInvoice,
        nextDueInvoice: c.nextDueInvoice,
      })),
      safeToSpend: safe,
      goals: goals.filter((g) => g.status === 'active').slice(0, 4),
    };
  }

  // ─── Séries para gráficos ──────────────────────────────────────────────────

  /** Receitas x despesas, saldo e patrimônio mês a mês. */
  async monthly(userId: string, from: string, to: string) {
    const now = today();
    const flows = await monthlyFlows(this.db, userId, from, to);
    const months = monthRange(from, to);
    const balances = await Promise.all(
      months.map((m) => (`${m}-01` <= now ? balancesAsOf(this.db, userId, monthEnd(m) < now ? monthEnd(m) : now) : null)),
    );
    return months.map((m, i) => {
      const f = flows.get(m);
      const income = f?.incomeCents ?? 0n;
      const expense = f?.expenseCents ?? 0n;
      const b = balances[i];
      return {
        month: m,
        income: fromCents(income),
        expenses: fromCents(expense),
        net: fromCents(income - expense),
        savingsRate: percent(income - expense, income),
        fixedIncome: fromCents(f?.fixedIncomeCents ?? 0n),
        variableIncome: fromCents(income - (f?.fixedIncomeCents ?? 0n)),
        recurringExpenses: fromCents(f?.recurringExpenseCents ?? 0n),
        installmentExpenses: fromCents(f?.installmentExpenseCents ?? 0n),
        essentialExpenses: fromCents(f?.essentialExpenseCents ?? 0n),
        endBalance: b ? fromCents(b.liquidCents) : null,
        endNetWorth: b ? fromCents(b.netWorthCents) : null,
      };
    });
  }

  async categories(userId: string, from: string, to: string, type: 'income' | 'expense', rollup: boolean) {
    const rows = await categoryTotals(this.db, userId, from, to, type, rollup);
    const total = rows.reduce((a, r) => a + r.totalCents, 0n);
    return { total: fromCents(total), categories: rows.map((r) => serializeCategory(r, total)) };
  }

  async balance(userId: string, from: string, to: string) {
    return dailyLiquidBalance(this.db, userId, from, to);
  }

  /** Gastos recorrentes: valor mensal equivalente de cada modelo ativo. */
  async recurringSpend(userId: string) {
    const list = await new RecurringService(this.db).list(userId, false);
    const expenses = list.filter((r) => r.type === 'expense');
    const totalExpense = expenses.reduce((a, r) => a + toCents(r.monthlyEquivalent), 0n);
    const totalIncome = list.filter((r) => r.type === 'income').reduce((a, r) => a + toCents(r.monthlyEquivalent), 0n);
    return {
      monthlyTotal: fromCents(totalExpense),
      monthlyIncome: fromCents(totalIncome),
      shareOfIncome: percent(totalExpense, totalIncome),
      items: expenses
        .sort((a, b) => (toCents(b.monthlyEquivalent) > toCents(a.monthlyEquivalent) ? 1 : -1))
        .map((r) => ({
          id: r.id,
          description: r.description,
          categoryId: r.categoryId,
          accountName: r.accountName,
          frequency: r.frequency,
          amount: r.amount,
          monthlyEquivalent: r.monthlyEquivalent,
          nextOccurrence: r.nextOccurrence,
        })),
    };
  }

  // ─── Relatórios ────────────────────────────────────────────────────────────

  async weeklyReport(userId: string, date: string) {
    const start = weekStart(date);
    const end = addDays(start, 6);
    const flows = await periodFlows(this.db, userId, start, end);
    const cats = await categoryTotals(this.db, userId, start, end, 'expense', true);

    const previous = [];
    for (let i = 1; i <= 4; i++) {
      const s = addDays(start, -7 * i);
      const f = await periodFlows(this.db, userId, s, addDays(s, 6));
      previous.push({ weekStart: s, income: fromCents(f.incomeCents), expenses: fromCents(f.expenseCents) });
    }
    const prevAvg = previous.reduce((a, w) => a + toCents(w.expenses), 0n) / 4n;
    const last = previous[0]!;

    return {
      weekStart: start,
      weekEnd: end,
      income: fromCents(flows.incomeCents),
      expenses: fromCents(flows.expenseCents),
      net: fromCents(flows.incomeCents - flows.expenseCents),
      topCategories: cats.slice(0, 5).map((c) => serializeCategory(c, flows.expenseCents)),
      biggestExpenses: await topExpenses(this.db, userId, start, end, 5),
      comparison: {
        previousWeekExpenses: last.expenses,
        changeVsPreviousWeek: change(flows.expenseCents, toCents(last.expenses)),
        average4WeeksExpenses: fromCents(prevAvg),
        changeVsAverage: change(flows.expenseCents, prevAvg),
      },
      previousWeeks: previous,
    };
  }

  async monthlyReport(userId: string, month: string) {
    const start = `${month}-01`;
    const end = monthEnd(month);
    const prev = addMonthsToKey(month, -1);
    const [flowsMap, cats, prevCats, avgCats] = await Promise.all([
      monthlyFlows(this.db, userId, prev, month),
      categoryTotals(this.db, userId, start, end, 'expense', true),
      categoryTotals(this.db, userId, `${prev}-01`, monthEnd(prev), 'expense', true),
      categoryTotals(this.db, userId, `${addMonthsToKey(month, -3)}-01`, monthEnd(prev), 'expense', true),
    ]);
    const cur = flowsMap.get(month);
    const before = flowsMap.get(prev);
    const income = cur?.incomeCents ?? 0n;
    const expense = cur?.expenseCents ?? 0n;
    const prevIncome = before?.incomeCents ?? 0n;
    const prevExpense = before?.expenseCents ?? 0n;
    const essential = cur?.essentialExpenseCents ?? 0n;

    const prevByCat = new Map(prevCats.map((c) => [c.categoryId, c.totalCents]));
    const avgByCat = new Map(avgCats.map((c) => [c.categoryId, c.totalCents / 3n]));

    // Padrões determinísticos: categorias acima da média dos 3 meses anteriores.
    const insights = cats
      .map((c) => {
        const avg = avgByCat.get(c.categoryId) ?? 0n;
        const diff = c.totalCents - avg;
        return { c, avg, diff, pct: change(c.totalCents, avg) };
      })
      .filter((x) => x.avg > 0n && x.diff >= 5000n && x.pct !== null && Number(x.pct) >= 20)
      .sort((a, b) => (b.diff > a.diff ? 1 : -1))
      .slice(0, 5)
      .map((x) => ({
        categoryId: x.c.categoryId,
        category: x.c.name,
        current: fromCents(x.c.totalCents),
        average3m: fromCents(x.avg),
        changePercent: x.pct!,
        message: `Seus gastos com ${x.c.name} aumentaram ${Math.round(Number(x.pct))}% em relação à média dos últimos 3 meses.`,
      }));

    return {
      month,
      income: fromCents(income),
      expenses: fromCents(expense),
      balance: fromCents(income - expense),
      savingsRate: percent(income - expense, income),
      fixedIncome: fromCents(cur?.fixedIncomeCents ?? 0n),
      variableIncome: fromCents(income - (cur?.fixedIncomeCents ?? 0n)),
      essentialExpenses: fromCents(essential),
      lifestyleExpenses: fromCents(expense - essential),
      byCategory: cats.map((c) => ({
        ...serializeCategory(c, expense),
        previous: fromCents(prevByCat.get(c.categoryId) ?? 0n),
        changeVsPrevious: change(c.totalCents, prevByCat.get(c.categoryId) ?? 0n),
      })),
      comparison: {
        previousMonth: prev,
        previousIncome: fromCents(prevIncome),
        previousExpenses: fromCents(prevExpense),
        incomeChange: change(income, prevIncome),
        expensesChange: change(expense, prevExpense),
        previousSavingsRate: percent(prevIncome - prevExpense, prevIncome),
      },
      biggestExpenses: await topExpenses(this.db, userId, start, end, 5),
      insights,
    };
  }

  async yearlyReport(userId: string, year: number) {
    const from = `${year}-01`;
    const to = `${year}-12`;
    const now = today();
    const months = await this.monthly(userId, from, to);
    const elapsed = months.filter((m) => `${m.month}-01` <= now);
    const totalIncome = months.reduce((a, m) => a + toCents(m.income), 0n);
    const totalExpense = months.reduce((a, m) => a + toCents(m.expenses), 0n);
    const n = BigInt(Math.max(1, elapsed.length));
    const cats = await categoryTotals(this.db, userId, `${year}-01-01`, `${year}-12-31`, 'expense', true);
    const invested = await netInvested(this.db, userId, `${year}-01-01`, `${year}-12-31`);
    const startNetWorth = await balancesAsOf(this.db, userId, `${year - 1}-12-31`);
    const withData = elapsed.filter((m) => toCents(m.income) !== 0n || toCents(m.expenses) !== 0n);
    const byNet = [...withData].sort((a, b) => (toCents(b.net) > toCents(a.net) ? 1 : -1));

    return {
      year,
      totalIncome: fromCents(totalIncome),
      totalExpenses: fromCents(totalExpense),
      balance: fromCents(totalIncome - totalExpense),
      savingsRate: percent(totalIncome - totalExpense, totalIncome),
      totalInvested: fromCents(invested),
      monthlyAverageIncome: fromCents(totalIncome / n),
      monthlyAverageExpenses: fromCents(totalExpense / n),
      startNetWorth: fromCents(startNetWorth.netWorthCents),
      endNetWorth: elapsed.at(-1)?.endNetWorth ?? fromCents(startNetWorth.netWorthCents),
      topCategories: cats.slice(0, 8).map((c) => serializeCategory(c, totalExpense)),
      bestMonth: byNet[0]?.month ?? null,
      worstMonth: byNet.at(-1)?.month ?? null,
      months,
    };
  }

  // ─── Métricas ──────────────────────────────────────────────────────────────

  async metrics(userId: string, month?: string) {
    const now = today();
    const m = month ?? monthKey(now);
    const start = `${m}-01`;
    const end = monthEnd(m);
    const mtdEnd = end < now ? end : now;

    const [flows, safe, balances, rules, installments, avgVariable, last3, last6, ytd, forecast, forecastVar] = await Promise.all([
      periodFlows(this.db, userId, start, mtdEnd),
      safeToSpend(this.db, userId, m),
      balancesAsOf(this.db, userId, now),
      RecurringService.activeRules(this.db, userId),
      InstallmentPlansService.monthlyTotals(this.db, userId, m, m),
      averageVariable3m(this.db, userId, m),
      periodFlows(this.db, userId, `${addMonthsToKey(m, -3)}-01`, monthEnd(addMonthsToKey(m, -1))),
      periodFlows(this.db, userId, `${addMonthsToKey(m, -6)}-01`, monthEnd(addMonthsToKey(m, -1))),
      periodFlows(this.db, userId, `${m.slice(0, 4)}-01-01`, mtdEnd),
      buildForecast(this.db, userId, { months: 7, includeVariableAverage: false }),
      buildForecast(this.db, userId, { months: 7, includeVariableAverage: true }),
    ]);

    const fixedRecurring = allOccurrences(rules, start, end)
      .filter((o) => o.amountCents < 0n)
      .reduce((a, o) => a - o.amountCents, 0n);
    const monthInstallments = installments.get(m)?.total ?? 0n;
    const fixedCosts = fixedRecurring + monthInstallments;
    const income = toCents(safe.income);
    const burnRate = last3.expenseCents / 3n;
    const breakEven = fixedCosts + avgVariable;
    const daysElapsed = Math.max(1, diffDays(start, mtdEnd) + 1);
    const at = (k: number) => forecast.months[k]?.endBalance ?? null;
    const atVar = (k: number) => forecastVar.months[k]?.endBalance ?? null;

    return {
      month: m,
      savingsMargin: {
        income: fromCents(flows.incomeCents),
        expenses: fromCents(flows.expenseCents),
        rate: percent(flows.incomeCents - flows.expenseCents, flows.incomeCents),
      },
      burnRate: {
        /** Despesa média mensal dos últimos 3 meses completos. */
        monthly: fromCents(burnRate),
        /** Meses que o saldo atual cobre nesse ritmo, sem nenhuma receita. */
        runwayMonths: burnRate > 0n ? (Number((balances.liquidCents * 10n) / burnRate) / 10).toFixed(1) : null,
      },
      breakEven: {
        fixedCosts: fromCents(fixedCosts),
        averageVariable: fromCents(avgVariable),
        /** Receita mínima mensal para não fechar no negativo. */
        requiredIncome: fromCents(breakEven),
        currentIncome: fromCents(income),
        coverage: percent(income, breakEven),
      },
      accumulatedExpenses: {
        monthToDate: fromCents(flows.expenseCents),
        yearToDate: fromCents(ytd.expenseCents),
      },
      incomeCommitment: {
        fixedRecurring: fromCents(fixedRecurring),
        installments: fromCents(monthInstallments),
        /** % da receita já comprometida com fixos + parcelas. */
        percent: percent(fixedCosts, income),
      },
      averageSpending: {
        dailyThisMonth: fromCents(flows.expenseCents / BigInt(daysElapsed)),
        monthlyLast6: fromCents(last6.expenseCents / 6n),
      },
      balanceProjection: {
        current: fromCents(balances.liquidCents),
        endOfMonth: at(0),
        in3Months: at(3),
        in6Months: at(6),
        withVariableSpending: { endOfMonth: atVar(0), in3Months: atVar(3), in6Months: atVar(6) },
      },
    };
  }
}
