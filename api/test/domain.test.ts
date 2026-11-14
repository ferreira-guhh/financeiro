import { describe, expect, it } from 'vitest';
import { invoicePeriodForDate, invoiceStatus, periodFromDueMonth, shiftPeriod } from '../src/domain/credit-card.js';
import { addMonths, monthRange, weekStart } from '../src/domain/dates.js';
import { buildInstallmentSchedule, splitInstallments } from '../src/domain/installments.js';
import { monthlyEquivalentCents, nextOccurrence, occurrencesBetween } from '../src/domain/recurrence.js';
import { goalTimeline, requiredMonthlyContribution } from '../src/domain/simulation/goals.js';
import { projectSavings } from '../src/domain/simulation/savings.js';
import { runScenario } from '../src/domain/simulation/scenario.js';

describe('datas', () => {
  it('soma meses limitando ao fim do mês e preservando o dia âncora', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-01-31', 2, 31)).toBe('2026-03-31');
    expect(addMonths('2026-11-15', 2)).toBe('2027-01-15');
  });
  it('semana começa na segunda-feira', () => {
    expect(weekStart('2026-11-08')).toBe('2026-11-02'); // domingo
    expect(weekStart('2026-11-09')).toBe('2026-11-09'); // segunda
  });
  it('gera intervalos de meses inclusivos', () => {
    expect(monthRange('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });
});

describe('ciclo da fatura', () => {
  const cycle = { closingDay: 3, dueDay: 10 }; // fecha dia 3, vence dia 10 (mesmo mês)

  it('compra antes do fechamento entra na fatura do mês; no dia do fechamento vai para a próxima', () => {
    expect(invoicePeriodForDate('2026-11-02', cycle)).toMatchObject({ key: '2026-11', closingDate: '2026-11-03', dueDate: '2026-11-10' });
    expect(invoicePeriodForDate('2026-11-03', cycle).key).toBe('2026-12');
    expect(invoicePeriodForDate('2026-11-30', cycle).key).toBe('2026-12');
  });

  it('vencimento antes do fechamento cai no mês seguinte', () => {
    const c = { closingDay: 25, dueDay: 5 };
    expect(invoicePeriodForDate('2026-11-20', c)).toMatchObject({ key: '2026-12', closingDate: '2026-11-25', dueDate: '2026-12-05' });
    expect(invoicePeriodForDate('2026-11-25', c)).toMatchObject({ key: '2027-01', closingDate: '2026-12-25' });
  });

  it('fechamento no dia 31 se ajusta a meses curtos', () => {
    const c = { closingDay: 31, dueDay: 10 };
    expect(periodFromDueMonth('2026-03', c)).toMatchObject({ closingDate: '2026-02-28', dueDate: '2026-03-10' });
    expect(invoicePeriodForDate('2026-02-28', c).key).toBe('2026-04');
  });

  it('desloca períodos e deriva status', () => {
    const p = invoicePeriodForDate('2026-11-02', cycle);
    expect(shiftPeriod(p, 11, cycle).key).toBe('2027-10');
    const base = { closingDate: '2026-11-03', dueDate: '2026-11-10', totalCents: 1000n };
    expect(invoiceStatus({ ...base, today: '2026-11-01', paidCents: 0n })).toBe('open');
    expect(invoiceStatus({ ...base, today: '2026-11-05', paidCents: 0n })).toBe('closed');
    expect(invoiceStatus({ ...base, today: '2026-11-11', paidCents: 500n })).toBe('overdue');
    expect(invoiceStatus({ ...base, today: '2026-11-11', paidCents: 1000n })).toBe('paid');
  });
});

describe('parcelamento', () => {
  it('R$ 3.600 em 12x = 12 de R$ 300', () => {
    expect(splitInstallments(360000n, 12)).toEqual(Array(12).fill(30000n));
  });
  it('resíduo de centavos fica na 1ª parcela e a soma fecha', () => {
    const parts = splitInstallments(10000n, 3);
    expect(parts).toEqual([3334n, 3333n, 3333n]);
    expect(parts.reduce((a, b) => a + b)).toBe(10000n);
  });
  it('distribui datas mantendo o dia da compra', () => {
    const s = buildInstallmentSchedule('2026-01-31', splitInstallments(30000n, 3));
    expect(s.map((x) => x.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });
  it('rejeita parcelas menores que um centavo', () => {
    expect(() => splitInstallments(2n, 3)).toThrow();
  });
});

describe('recorrência', () => {
  it('mensal com dia 31 usa o último dia em meses curtos', () => {
    const rule = { frequency: 'monthly' as const, interval: 1, dayOfMonth: 31, startDate: '2026-01-01', endDate: null };
    expect(occurrencesBetween(rule, '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });
  it('trimestral, semanal e anual', () => {
    const q = { frequency: 'monthly' as const, interval: 3, dayOfMonth: 10, startDate: '2026-01-10', endDate: null };
    expect(occurrencesBetween(q, '2026-01-01', '2026-12-31')).toEqual(['2026-01-10', '2026-04-10', '2026-07-10', '2026-10-10']);
    const w = { frequency: 'weekly' as const, interval: 2, dayOfMonth: null, startDate: '2026-11-02', endDate: null };
    expect(occurrencesBetween(w, '2026-11-10', '2026-12-01')).toEqual(['2026-11-16', '2026-11-30']);
    const y = { frequency: 'yearly' as const, interval: 1, dayOfMonth: 15, startDate: '2025-03-15', endDate: '2027-01-01' };
    expect(occurrencesBetween(y, '2025-01-01', '2030-01-01')).toEqual(['2025-03-15', '2026-03-15']);
  });
  it('respeita início, fim e calcula a próxima ocorrência', () => {
    const rule = { frequency: 'monthly' as const, interval: 1, dayOfMonth: 5, startDate: '2026-11-08', endDate: '2027-01-31' };
    expect(occurrencesBetween(rule, '2026-01-01', '2027-12-31')).toEqual(['2026-12-05', '2027-01-05']);
    expect(nextOccurrence(rule, '2027-01-06')).toBeNull();
    expect(nextOccurrence({ ...rule, endDate: null }, '2030-06-06')).toBe('2030-07-05');
  });
  it('equivalente mensal', () => {
    expect(monthlyEquivalentCents(12000n, 'yearly', 1)).toBe(1000n);
    expect(monthlyEquivalentCents(10000n, 'weekly', 1)).toBe(43333n);
    expect(monthlyEquivalentCents(30000n, 'monthly', 3)).toBe(10000n);
  });
});

describe('simulações', () => {
  it('sem juros, R$ 300/mês por 24 meses = R$ 7.200', () => {
    const r = projectSavings({ initialAmount: '0', monthlyContribution: '300', annualRatePercent: '0', months: 24, startMonth: '2026-12' });
    expect(r.summary.finalBalance).toBe('7200.00');
    expect(r.months).toHaveLength(24);
    expect(r.months.at(-1)?.month).toBe('2028-11');
  });

  it('juros compostos: R$ 1.000 a 12% a.a. por 12 meses = R$ 1.120,00 (taxa equivalente)', () => {
    const r = projectSavings({ initialAmount: '1000', monthlyContribution: '0', annualRatePercent: '12', months: 12, startMonth: '2026-12' });
    // Arredondamento mensal ao centavo pode desviar no máximo alguns centavos.
    expect(Math.abs(Number(r.summary.finalBalance) - 1120)).toBeLessThan(0.05);
  });

  it('inflação reduz o valor real', () => {
    const r = projectSavings({ initialAmount: '1000', monthlyContribution: '0', annualRatePercent: '0', annualInflationPercent: '10', months: 12, startMonth: '2026-12' });
    expect(r.summary.finalRealBalance).toBe('909.09');
  });

  it('meta: prazo e aporte necessário', () => {
    const t = goalTimeline({ targetAmount: '10000', currentAmount: '1000', monthlyContribution: '500', startMonth: '2026-12' });
    expect(t.months).toBe(18);
    expect(t.reachedMonth).toBe('2028-05');
    expect(requiredMonthlyContribution({ targetAmount: '10000', currentAmount: '1000', months: 18 })).toBe('500.00');
    expect(requiredMonthlyContribution({ targetAmount: '10000', currentAmount: '1000', months: 7 })).toBe('1285.72');
    const never = goalTimeline({ targetAmount: '10000', currentAmount: '0', monthlyContribution: '0', startMonth: '2026-12' });
    expect(never).toMatchObject({ reached: false, months: null });
  });

  it('cenário: cortar R$ 150 antecipa a meta; parcela nova atrasa', () => {
    const baseline = {
      startMonth: '2026-12',
      months: 24,
      startingBalance: '0',
      monthlyIncome: '5000',
      monthlyFixedExpenses: '3000',
      monthlyVariableExpenses: '1500',
      installmentsByMonth: {},
    };
    const goal = { name: 'Viagem', targetAmount: '6000', currentAmount: '0', monthlyContribution: '500' };

    const cut = runScenario(baseline, { expenseCuts: [{ label: 'Delivery', monthlyAmount: '150' }] }, goal);
    expect(cut.summary.difference).toBe('3600.00');
    expect(cut.goalImpact?.baseline.months).toBe(12);
    expect(cut.goalImpact?.scenario.months).toBe(10); // 650/mês → 10 meses
    expect(cut.goalImpact?.monthsDifference).toBe(-2);

    const buy = runScenario(baseline, { newInstallmentPurchases: [{ label: 'Notebook', totalAmount: '3600', installments: 12 }] }, goal);
    expect(buy.months[0]?.scenarioExpenses).toBe('4800.00');
    expect(buy.months[12]?.scenarioExpenses).toBe('4500.00');
    expect(buy.goalImpact?.scenario.months).toBe(20); // 12 × 200 + 8 × 500 = 6.400
  });
});
