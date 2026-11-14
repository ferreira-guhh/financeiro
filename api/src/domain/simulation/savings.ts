/**
 * Projeção de patrimônio: juros compostos + aportes mensais + inflação.
 * "Se eu economizar R$ 300 por mês durante 2 anos, quanto terei?"
 */
import { addMonthsToKey, type MonthKey } from '../dates.js';
import { D, ZERO, cents, money, monthlyRateFromAnnualPercent, type Dec } from './decimal.js';

export interface SavingsInput {
  initialAmount: string;
  monthlyContribution: string;
  /** % a.a. (ex.: "10.5"). */
  annualRatePercent: string;
  months: number;
  /** % a.a. — se informado, calcula também o valor em poder de compra de hoje. */
  annualInflationPercent?: string;
  /** Reajuste anual do aporte em % (ex.: aumentar o aporte com a inflação). */
  annualContributionIncreasePercent?: string;
  /** Aporte no início ou no fim do mês (padrão: fim). */
  contributionTiming?: 'start' | 'end';
  startMonth: MonthKey;
}

export interface SavingsMonth {
  month: MonthKey;
  contribution: string;
  interest: string;
  balance: string;
  totalContributed: string;
  totalInterest: string;
  /** Saldo descontado da inflação acumulada (poder de compra de hoje). */
  realBalance: string;
}

export interface SavingsResult {
  months: SavingsMonth[];
  summary: {
    finalBalance: string;
    totalContributed: string;
    totalInterest: string;
    finalRealBalance: string;
    /** Quanto da riqueza final veio de juros (%). */
    interestShare: string;
  };
}

export function projectSavings(input: SavingsInput): SavingsResult {
  const rate = monthlyRateFromAnnualPercent(input.annualRatePercent);
  const inflation = monthlyRateFromAnnualPercent(input.annualInflationPercent ?? '0');
  const contributionIncrease = new D(input.annualContributionIncreasePercent ?? '0').div(100);
  const timing = input.contributionTiming ?? 'end';

  let balance = cents(new D(input.initialAmount));
  let contribution = cents(new D(input.monthlyContribution));
  let totalContributed = balance;
  let totalInterest: Dec = ZERO;
  let inflationIndex = new D(1);
  const months: SavingsMonth[] = [];

  for (let i = 0; i < input.months; i++) {
    if (i > 0 && i % 12 === 0 && !contributionIncrease.isZero()) {
      contribution = cents(contribution.times(contributionIncrease.plus(1)));
    }
    if (timing === 'start') balance = balance.plus(contribution);
    // Juros creditados mês a mês, arredondados ao centavo como num extrato real.
    const interest = cents(balance.times(rate));
    balance = balance.plus(interest);
    if (timing === 'end') balance = balance.plus(contribution);

    totalContributed = totalContributed.plus(contribution);
    totalInterest = totalInterest.plus(interest);
    inflationIndex = inflationIndex.times(inflation.plus(1));

    months.push({
      month: addMonthsToKey(input.startMonth, i),
      contribution: money(contribution),
      interest: money(interest),
      balance: money(balance),
      totalContributed: money(totalContributed),
      totalInterest: money(totalInterest),
      realBalance: money(balance.div(inflationIndex)),
    });
  }

  const finalReal = months.at(-1)?.realBalance ?? money(balance);
  return {
    months,
    summary: {
      finalBalance: money(balance),
      totalContributed: money(totalContributed),
      totalInterest: money(totalInterest),
      finalRealBalance: finalReal,
      interestShare: balance.isZero() ? '0.00' : totalInterest.div(balance).times(100).toFixed(2),
    },
  };
}
