/**
 * Cenário "E se?" sobre o orçamento mensal: compara a linha de base do usuário com
 * mudanças hipotéticas (cortes, aumento de renda, novas parcelas, novas recorrentes)
 * e mede o impacto no saldo acumulado e no prazo de uma meta.
 */
import { addMonthsToKey, monthsBetween, type MonthKey } from '../dates.js';
import { splitInstallments } from '../installments.js';
import { toCents } from '../../lib/money.js';
import { D, ZERO, money, type Dec } from './decimal.js';
import { goalTimeline, type GoalTimelineResult } from './goals.js';

export interface ScenarioBaseline {
  startMonth: MonthKey;
  months: number;
  startingBalance: string;
  monthlyIncome: string;
  monthlyFixedExpenses: string;
  monthlyVariableExpenses: string;
  /** Parcelas já contratadas por mês (YYYY-MM → valor). */
  installmentsByMonth: Record<MonthKey, string>;
}

export interface ScenarioAdjustments {
  incomeChange?: { amount?: string; percent?: string; startMonth?: MonthKey };
  expenseCuts?: { label: string; monthlyAmount: string; startMonth?: MonthKey }[];
  newRecurringExpenses?: { label: string; monthlyAmount: string; startMonth?: MonthKey; endMonth?: MonthKey }[];
  newInstallmentPurchases?: { label: string; totalAmount: string; installments: number; startMonth?: MonthKey }[];
}

export interface ScenarioGoal {
  name: string;
  targetAmount: string;
  currentAmount: string;
  monthlyContribution: string;
  annualRatePercent?: string;
}

export interface ScenarioMonth {
  month: MonthKey;
  baselineIncome: string;
  baselineExpenses: string;
  baselineNet: string;
  scenarioIncome: string;
  scenarioExpenses: string;
  scenarioNet: string;
  baselineBalance: string;
  scenarioBalance: string;
}

export interface ScenarioResult {
  months: ScenarioMonth[];
  summary: {
    baselineFinalBalance: string;
    scenarioFinalBalance: string;
    difference: string;
    averageMonthlyDifference: string;
    /** Primeiro mês em que o saldo acumulado do cenário fica negativo. */
    scenarioFirstNegativeMonth: MonthKey | null;
  };
  goalImpact: {
    goal: string;
    baseline: Pick<GoalTimelineResult, 'reached' | 'months' | 'reachedMonth'>;
    scenario: Pick<GoalTimelineResult, 'reached' | 'months' | 'reachedMonth'>;
    /** Negativo = cenário antecipa a meta; positivo = atrasa. null se alguma não atinge. */
    monthsDifference: number | null;
  } | null;
}

const active = (month: MonthKey, start: MonthKey | undefined, end?: MonthKey) =>
  (!start || month >= start) && (!end || month <= end);

export function runScenario(
  baseline: ScenarioBaseline,
  adjustments: ScenarioAdjustments,
  goal?: ScenarioGoal,
): ScenarioResult {
  const income = new D(baseline.monthlyIncome);
  const fixed = new D(baseline.monthlyFixedExpenses);
  const variable = new D(baseline.monthlyVariableExpenses);

  // Parcelas das novas compras simuladas, distribuídas com o mesmo motor do sistema real.
  const extraInstallments = new Map<MonthKey, Dec>();
  for (const purchase of adjustments.newInstallmentPurchases ?? []) {
    const start = purchase.startMonth ?? baseline.startMonth;
    const parts = splitInstallments(toCents(purchase.totalAmount), purchase.installments);
    parts.forEach((c, i) => {
      const key = addMonthsToKey(start, i);
      extraInstallments.set(key, (extraInstallments.get(key) ?? ZERO).plus(new D(c.toString()).div(100)));
    });
  }

  let baseBalance = new D(baseline.startingBalance);
  let scenBalance = new D(baseline.startingBalance);
  let firstNegative: MonthKey | null = null;
  const months: ScenarioMonth[] = [];
  const deltas: Dec[] = [];

  for (let i = 0; i < baseline.months; i++) {
    const month = addMonthsToKey(baseline.startMonth, i);
    const installments = new D(baseline.installmentsByMonth[month] ?? '0');
    const baseExpenses = fixed.plus(variable).plus(installments);
    const baseNet = income.minus(baseExpenses);

    let scenIncome = income;
    const ic = adjustments.incomeChange;
    if (ic && active(month, ic.startMonth)) {
      if (ic.amount) scenIncome = scenIncome.plus(ic.amount);
      if (ic.percent) scenIncome = scenIncome.plus(income.times(ic.percent).div(100));
    }

    let scenExpenses = baseExpenses.plus(extraInstallments.get(month) ?? ZERO);
    for (const cut of adjustments.expenseCuts ?? []) {
      if (active(month, cut.startMonth)) scenExpenses = scenExpenses.minus(cut.monthlyAmount);
    }
    for (const rec of adjustments.newRecurringExpenses ?? []) {
      if (active(month, rec.startMonth, rec.endMonth)) scenExpenses = scenExpenses.plus(rec.monthlyAmount);
    }
    scenExpenses = D.max(scenExpenses, ZERO);
    const scenNet = scenIncome.minus(scenExpenses);

    baseBalance = baseBalance.plus(baseNet);
    scenBalance = scenBalance.plus(scenNet);
    if (!firstNegative && scenBalance.isNegative()) firstNegative = month;
    deltas.push(scenNet.minus(baseNet));

    months.push({
      month,
      baselineIncome: money(income),
      baselineExpenses: money(baseExpenses),
      baselineNet: money(baseNet),
      scenarioIncome: money(scenIncome),
      scenarioExpenses: money(scenExpenses),
      scenarioNet: money(scenNet),
      baselineBalance: money(baseBalance),
      scenarioBalance: money(scenBalance),
    });
  }

  const totalDelta = deltas.reduce((a, b) => a.plus(b), ZERO);

  let goalImpact: ScenarioResult['goalImpact'] = null;
  if (goal) {
    const startMonth = baseline.startMonth;
    const base = goalTimeline({ ...goal, startMonth });
    // A diferença de sobra mensal do cenário vai (ou deixa de ir) para a meta.
    const scenarioContributions = deltas.map((d) => money(D.max(new D(goal.monthlyContribution).plus(d), ZERO)));
    const lastDelta = deltas.at(-1) ?? ZERO;
    scenarioContributions.push(money(D.max(new D(goal.monthlyContribution).plus(lastDelta), ZERO)));
    const scen = goalTimeline({ ...goal, monthlyContribution: scenarioContributions, startMonth });
    const pick = (r: GoalTimelineResult) => ({ reached: r.reached, months: r.months, reachedMonth: r.reachedMonth });
    goalImpact = {
      goal: goal.name,
      baseline: pick(base),
      scenario: pick(scen),
      monthsDifference:
        base.reachedMonth && scen.reachedMonth ? monthsBetween(base.reachedMonth, scen.reachedMonth) : null,
    };
  }

  return {
    months,
    summary: {
      baselineFinalBalance: money(baseBalance),
      scenarioFinalBalance: money(scenBalance),
      difference: money(scenBalance.minus(baseBalance)),
      averageMonthlyDifference: baseline.months ? money(totalDelta.div(baseline.months)) : '0.00',
      scenarioFirstNegativeMonth: firstNegative,
    },
    goalImpact,
  };
}
