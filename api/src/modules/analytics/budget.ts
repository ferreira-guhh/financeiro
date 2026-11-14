/**
 * Orçamento do mês: margem discricionária ("gasto seguro") e linha de base para simulações.
 *
 * Gasto seguro = receita − despesas fixas − parcelas − outras contas agendadas
 *                − reserva − aportes de metas − folga de segurança
 *
 * É uma ESTIMATIVA configurável, não recomendação financeira profissional.
 */
import { and, eq, gte, isNull, lte, ne, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client.js';
import { transactions } from '../../db/schema.js';
import { addMonthsToKey, daysInMonth, diffDays, monthEnd, monthKey, parseMonth } from '../../domain/dates.js';
import { monthlyEquivalentCents } from '../../domain/recurrence.js';
import { today } from '../../lib/clock.js';
import { fromCents, normalizeMoney, toCents } from '../../lib/money.js';
import { GoalsService } from '../goals/goals.service.js';
import { InstallmentPlansService } from '../installment-plans/installment-plans.service.js';
import { RecurringService, allOccurrences } from '../recurring/recurring.service.js';
import { getSettings } from '../settings/settings.module.js';
import { balancesAsOf, periodFlows, variableExpense } from './queries.js';

export const SAFE_TO_SPEND_DISCLAIMER =
  'Estimativa calculada a partir dos seus dados e parâmetros. Não é recomendação financeira profissional.';

const pos = (v: bigint) => (v > 0n ? v : 0n);

/** Média mensal de receitas realizadas nos 3 meses completos anteriores a `month`. */
export async function averageIncome3m(db: DbExecutor, userId: string, month: string): Promise<bigint> {
  const from = `${addMonthsToKey(month, -3)}-01`;
  const to = monthEnd(addMonthsToKey(month, -1));
  const flows = await periodFlows(db, userId, from, to);
  return flows.incomeCents / 3n;
}

/** Média mensal da despesa variável (não recorrente, não parcela) nos 3 meses completos anteriores. */
export async function averageVariable3m(db: DbExecutor, userId: string, month: string): Promise<bigint> {
  const from = `${addMonthsToKey(month, -3)}-01`;
  const to = monthEnd(addMonthsToKey(month, -1));
  return (await variableExpense(db, userId, from, to)) / 3n;
}

export async function safeToSpend(db: DbExecutor, userId: string, month = monthKey(today())) {
  const settings = await getSettings(db, userId);
  const start = `${month}-01`;
  const end = monthEnd(month);
  const now = today();

  const rules = await RecurringService.activeRules(db, userId);
  const occurrences = allOccurrences(rules, start, end);
  const recurringIncome = occurrences.filter((o) => o.amountCents > 0n).reduce((a, o) => a + o.amountCents, 0n);
  const fixedExpenses = occurrences.filter((o) => o.amountCents < 0n).reduce((a, o) => a - o.amountCents, 0n);

  // Receita: conforme configuração (recorrente cai para a média se não houver nenhuma cadastrada).
  let incomeSource = settings.incomeBasis;
  let income: bigint;
  if (settings.incomeBasis === 'fixed') {
    income = toCents(settings.fixedMonthlyIncome ?? '0');
  } else if (settings.incomeBasis === 'recurring' && recurringIncome > 0n) {
    income = recurringIncome;
  } else {
    incomeSource = 'average_3m';
    income = await averageIncome3m(db, userId, month);
  }

  const installmentsMap = await InstallmentPlansService.monthlyTotals(db, userId, month, month);
  const installments = installmentsMap.get(month)?.total ?? 0n;

  // Outras contas já agendadas (pendentes que não são recorrência nem parcela).
  const [scheduled] = await db
    .select({ total: sql<string>`coalesce(-sum(${transactions.amount}), 0)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.status, 'pending'),
        eq(transactions.type, 'expense'),
        isNull(transactions.recurringTransactionId),
        ne(transactions.source, 'installment'),
        gte(transactions.date, start),
        lte(transactions.date, end),
      ),
    );
  const otherScheduled = toCents(normalizeMoney(scheduled!.total));

  const reserve = toCents(settings.monthlyReserveAmount);
  const goals = settings.includeGoalContributions ? await GoalsService.activeMonthlyContributions(db, userId) : 0n;
  const marginBp = BigInt(Math.round(Number(settings.safetyMarginPercent) * 100)); // basis points
  const safetyMargin = (income * marginBp) / 10_000n;

  const discretionary = income - fixedExpenses - installments - otherScheduled - reserve - goals - safetyMargin;

  // Gasto variável já realizado no mês (até hoje).
  const spentSoFar = await variableExpense(db, userId, start, end < now ? end : now);
  const remaining = discretionary - spentSoFar;
  const [y, m] = parseMonth(month);
  const isCurrent = month === monthKey(now);
  const daysLeft = isCurrent ? diffDays(now, end) + 1 : month > monthKey(now) ? daysInMonth(y, m) : 0;
  const dailySafe = daysLeft > 0 ? pos(remaining) / BigInt(daysLeft) : 0n;

  return {
    month,
    incomeSource,
    income: fromCents(income),
    fixedExpenses: fromCents(fixedExpenses),
    installments: fromCents(installments),
    otherScheduled: fromCents(otherScheduled),
    reserve: fromCents(reserve),
    goalContributions: fromCents(goals),
    safetyMargin: fromCents(safetyMargin),
    discretionary: fromCents(discretionary),
    spentSoFar: fromCents(spentSoFar),
    remaining: fromCents(remaining),
    daysLeft,
    dailySafeAmount: fromCents(dailySafe),
    disclaimer: SAFE_TO_SPEND_DISCLAIMER,
  };
}

/** Linha de base do orçamento para o simulador "E se?". */
export async function budgetBaseline(db: DbExecutor, userId: string, months: number) {
  const now = today();
  const month = monthKey(now);
  const settings = await getSettings(db, userId);
  const rules = await RecurringService.activeRules(db, userId);

  const monthly = (type: 'income' | 'expense') =>
    rules
      .filter((r) => r.type === type)
      .reduce((a, r) => a + monthlyEquivalentCents(toCents(normalizeMoney(r.amount)), r.frequency, r.interval), 0n);

  let income = settings.incomeBasis === 'fixed' ? toCents(settings.fixedMonthlyIncome ?? '0') : monthly('income');
  if (income === 0n) income = await averageIncome3m(db, userId, month);

  const installmentsMap = await InstallmentPlansService.monthlyTotals(db, userId, month, addMonthsToKey(month, months - 1));
  const installmentsByMonth: Record<string, string> = {};
  for (const [k, v] of installmentsMap) installmentsByMonth[k] = fromCents(v.total);

  const balances = await balancesAsOf(db, userId, now);
  return {
    startMonth: month,
    months,
    startingBalance: fromCents(balances.liquidCents),
    monthlyIncome: fromCents(income),
    monthlyFixedExpenses: fromCents(monthly('expense')),
    monthlyVariableExpenses: fromCents(await averageVariable3m(db, userId, month)),
    installmentsByMonth,
  };
}
