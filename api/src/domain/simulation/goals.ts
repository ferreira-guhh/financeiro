/**
 * Cálculos de metas: quanto falta, quanto guardar por mês e quando a meta será alcançada.
 * "Se eu cortar R$ 150 de delivery por mês, quando alcançarei minha meta?"
 */
import { addMonthsToKey, type MonthKey } from '../dates.js';
import { D, ZERO, cents, money, monthlyRateFromAnnualPercent, type Dec } from './decimal.js';

/** Limite de busca: 50 anos. Acima disso a meta é considerada inalcançável no ritmo atual. */
export const MAX_GOAL_MONTHS = 600;

export interface GoalTimelineInput {
  targetAmount: string;
  currentAmount: string;
  /** Aporte de cada mês. Se for array, o mês i usa contributions[i] (último valor se repete). */
  monthlyContribution: string | string[];
  annualRatePercent?: string;
  startMonth: MonthKey;
}

export interface GoalTimelineResult {
  reached: boolean;
  /** Meses até atingir (0 = já atingida). null = não atinge em 50 anos. */
  months: number | null;
  /** Mês em que a meta é atingida. */
  reachedMonth: MonthKey | null;
  totalContributed: string;
  totalInterest: string;
  /** Saldo projetado mês a mês (até atingir, máx. 600). */
  series: { month: MonthKey; balance: string }[];
}

export function goalTimeline(input: GoalTimelineInput): GoalTimelineResult {
  const target = new D(input.targetAmount);
  const rate = monthlyRateFromAnnualPercent(input.annualRatePercent ?? '0');
  const contributions = Array.isArray(input.monthlyContribution)
    ? input.monthlyContribution.map((c) => new D(c))
    : [new D(input.monthlyContribution)];

  let balance = cents(new D(input.currentAmount));
  let contributed: Dec = ZERO;
  let interestTotal: Dec = ZERO;
  const series: GoalTimelineResult['series'] = [];

  if (balance.gte(target)) {
    return { reached: true, months: 0, reachedMonth: input.startMonth, totalContributed: '0.00', totalInterest: '0.00', series };
  }

  for (let i = 0; i < MAX_GOAL_MONTHS; i++) {
    const contribution = cents(D.max(contributions[Math.min(i, contributions.length - 1)] ?? ZERO, ZERO));
    const interest = cents(balance.times(rate));
    balance = balance.plus(interest).plus(contribution);
    contributed = contributed.plus(contribution);
    interestTotal = interestTotal.plus(interest);
    const month = addMonthsToKey(input.startMonth, i);
    series.push({ month, balance: money(balance) });

    if (balance.gte(target)) {
      return {
        reached: true,
        months: i + 1,
        reachedMonth: month,
        totalContributed: money(contributed),
        totalInterest: money(interestTotal),
        series,
      };
    }
    // Sem aporte e sem rendimento positivo, nunca chega: evita 600 iterações inúteis.
    if (contribution.isZero() && rate.lte(0) && i >= contributions.length) break;
  }

  return {
    reached: false,
    months: null,
    reachedMonth: null,
    totalContributed: money(contributed),
    totalInterest: money(interestTotal),
    series,
  };
}

/**
 * Aporte mensal necessário para sair de `current` e chegar a `target` em `months` meses.
 * FV = PV·(1+i)^n + PMT·((1+i)^n − 1)/i  ⇒  PMT = (FV − PV·(1+i)^n)·i / ((1+i)^n − 1)
 * Arredonda PARA CIMA no centavo (garante que a meta seja atingida).
 */
export function requiredMonthlyContribution(params: {
  targetAmount: string;
  currentAmount: string;
  months: number;
  annualRatePercent?: string;
}): string {
  const target = new D(params.targetAmount);
  const current = new D(params.currentAmount);
  if (current.gte(target)) return '0.00';
  if (params.months <= 0) return money(target.minus(current));

  const i = monthlyRateFromAnnualPercent(params.annualRatePercent ?? '0');
  let pmt: Dec;
  if (i.isZero()) {
    pmt = target.minus(current).div(params.months);
  } else {
    const growth = i.plus(1).pow(params.months);
    pmt = target.minus(current.times(growth)).times(i).div(growth.minus(1));
  }
  return D.max(pmt, ZERO).toDecimalPlaces(2, D.ROUND_UP).toFixed(2);
}
