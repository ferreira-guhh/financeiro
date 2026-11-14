/**
 * Fase 3 — dashboard, relatórios, métricas, previsão e gasto seguro.
 * Relógio congelado em 2026-11-15 (domingo).
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { categoryId, createAccount, newUser, ok, type Api } from './helpers.js';

let app: FastifyInstance;
let api: Api;
let checking: { id: string };

beforeAll(async () => {
  app = await buildApp(env);
  api = await newUser(app);
  checking = await createAccount(api, { name: 'Corrente', initialBalance: '2000.00' });
  const card = await ok(
    api('POST', '/credit-cards', { name: 'Cartão', creditLimit: '10000.00', closingDay: 3, dueDay: 10, paymentAccountId: checking.id }),
    201,
  );

  await ok(api('PUT', '/settings', { incomeBasis: 'fixed', fixedMonthlyIncome: '5000.00', monthlyReserveAmount: '700.00' }));
  await ok(
    api('POST', '/recurring', {
      accountId: checking.id, type: 'expense', amount: '2500.00', description: 'Aluguel', dayOfMonth: 5, startDate: '2026-11-01',
      categoryId: await categoryId(api, 'Aluguel'),
    }),
    201,
  );
  await ok(api('POST', `/credit-cards/${card.id}/purchases`, { description: 'Sofá', amount: '6000.00', installments: 12, date: '2026-11-10' }), 201);

  const salario = await categoryId(api, 'Salário');
  const delivery = await categoryId(api, 'Delivery');
  const tx = (body: object) => ok(api('POST', '/transactions', { accountId: checking.id, ...body }), 201);
  await tx({ type: 'income', amount: '5000.00', date: '2026-11-05', description: 'Salário', categoryId: salario });
  await tx({ type: 'expense', amount: '200.00', date: '2026-11-12', description: 'Mercado' });
  for (const date of ['2026-08-11', '2026-09-11', '2026-10-11']) {
    await tx({ type: 'expense', amount: '300.00', date, description: 'iFood', categoryId: delivery });
  }
  await tx({ type: 'expense', amount: '414.00', date: '2026-11-11', description: 'iFood', categoryId: delivery });
});

afterAll(async () => {
  await app.close();
});

describe('gasto seguro (margem discricionária)', () => {
  it('reproduz o exemplo do planejamento: 5.000 − 2.500 − 500 − 700 = 1.300', async () => {
    const s = await ok(api('GET', '/safe-to-spend'));
    expect(s).toMatchObject({
      incomeSource: 'fixed',
      income: '5000.00',
      fixedExpenses: '2500.00',
      installments: '500.00',
      reserve: '700.00',
      discretionary: '1300.00',
      spentSoFar: '614.00', // mercado 200 + delivery 414 (parcela não é gasto variável)
      remaining: '686.00',
      daysLeft: 16,
      dailySafeAmount: '42.87',
    });
    expect(s.disclaimer).toMatch(/não é recomendação/i);
  });

  it('desconta aportes de metas ativas e folga de segurança', async () => {
    const goal = await ok(api('POST', '/goals', { name: 'Viagem', targetAmount: '5000.00', monthlyContribution: '200.00' }), 201);
    await ok(api('PUT', '/settings', { safetyMarginPercent: '10' }));
    const s = await ok(api('GET', '/safe-to-spend'));
    expect(s).toMatchObject({ goalContributions: '200.00', safetyMargin: '500.00', discretionary: '600.00' });
    await ok(api('PUT', '/settings', { safetyMarginPercent: '0' }));
    await ok(api('DELETE', `/goals/${goal.id}`), 204);
  });
});

describe('dashboard', () => {
  it('mostra saldos, mês, disponível, contas e cartões', async () => {
    const d = await ok(api('GET', '/dashboard'));
    expect(d.balances.current).toBe('5486.00'); // 2000 + 5000 − 200 − 900 − 414
    expect(d.balances.creditCardDebt).toBe('500.00');
    expect(d.monthSummary).toMatchObject({ income: '5000.00', expenses: '1114.00', net: '3886.00', savingsRate: '77.72' });
    expect(d.available.amount).toBe('2986.00'); // aluguel pendente de novembro sai hoje
    expect(d.upcomingBills.overdueCount).toBe(1);
    expect(d.creditCards[0].currentInvoice.total).toBe('500.00');
    expect(d.upcomingInstallments.months[0]).toMatchObject({ month: '2026-11', total: '500.00' });
  });
});

describe('previsão de fluxo de caixa', () => {
  it('projeta pendências, recorrências e faturas', async () => {
    const f = await ok(api('GET', '/forecast?months=2'));
    expect(f.startBalance).toBe('5486.00');
    expect(f.events.map((e: any) => [e.date, e.kind, e.amount])).toEqual([
      ['2026-11-15', 'pending', '-2500.00'],
      ['2026-12-05', 'recurring', '-2500.00'],
      ['2026-12-10', 'invoice', '-500.00'],
    ]);
    expect(f.summary).toMatchObject({ endBalance: '-14.00', firstNegativeDate: '2026-12-10' });
    expect(f.months.map((m: any) => m.endBalance)).toEqual(['2986.00', '-14.00']);

    const withVar = await ok(api('GET', '/forecast?months=2&includeVariableAverage=true'));
    expect(Number(withVar.summary.endBalance)).toBeLessThan(-14);
  });
});

describe('relatórios', () => {
  it('mensal: categorias, comparação e padrão detectado (+38% delivery)', async () => {
    const r = await ok(api('GET', '/reports/monthly?month=2026-11'));
    expect(r).toMatchObject({ income: '5000.00', expenses: '1114.00', fixedIncome: '0.00', variableIncome: '5000.00' });
    const alimentacao = r.byCategory.find((c: any) => c.name === 'Alimentação');
    expect(alimentacao).toMatchObject({ total: '414.00', previous: '300.00', changeVsPrevious: '38.00' });
    expect(r.insights[0].message).toBe('Seus gastos com Alimentação aumentaram 38% em relação à média dos últimos 3 meses.');
    expect(r.comparison).toMatchObject({ previousMonth: '2026-10', previousExpenses: '300.00' });
  });

  it('semanal: semana de segunda a domingo e maiores despesas', async () => {
    const r = await ok(api('GET', '/reports/weekly?date=2026-11-15'));
    expect(r).toMatchObject({ weekStart: '2026-11-09', weekEnd: '2026-11-15', expenses: '1114.00' });
    expect(r.biggestExpenses[0]).toMatchObject({ description: 'Sofá (1/12)', amount: '500.00' });
    expect(r.previousWeeks).toHaveLength(4);
  });

  it('anual: totais, médias e categorias', async () => {
    const r = await ok(api('GET', '/reports/yearly?year=2026'));
    expect(r).toMatchObject({ totalIncome: '5000.00', totalExpenses: '2014.00' });
    expect(r.months).toHaveLength(12);
    expect(r.topCategories[0].name).toBe('Alimentação');
  });
});

describe('analytics e métricas', () => {
  it('séries mensais, categorias, saldo diário e recorrentes', async () => {
    const m = await ok(api('GET', '/analytics/monthly?from=2026-09&to=2026-12'));
    expect(m.data.map((x: any) => x.expenses)).toEqual(['300.00', '300.00', '1114.00', '0.00']);
    expect(m.data[3].endBalance).toBeNull(); // mês futuro

    const c = await ok(api('GET', '/analytics/categories?from=2026-11-01&to=2026-11-30&groupBy=category'));
    expect(c.categories.map((x: any) => x.name)).toEqual(['Sem categoria', 'Delivery']);
    expect(c.total).toBe('1114.00');

    const b = await ok(api('GET', '/analytics/balance?from=2026-11-01&to=2026-11-15'));
    expect(b.data).toHaveLength(15);
    expect(b.data[0].balance).toBe('1100.00');
    expect(b.data.at(-1).balance).toBe('5486.00');

    const r = await ok(api('GET', '/analytics/recurring'));
    expect(r).toMatchObject({ monthlyTotal: '2500.00' });
  });

  it('métricas: comprometimento da renda, burn rate e ponto de equilíbrio', async () => {
    const m = await ok(api('GET', '/metrics'));
    expect(m.incomeCommitment).toMatchObject({ fixedRecurring: '2500.00', installments: '500.00', percent: '60.00' });
    expect(m.burnRate.monthly).toBe('300.00');
    expect(m.breakEven).toMatchObject({ fixedCosts: '3000.00', averageVariable: '300.00', requiredIncome: '3300.00' });
    expect(m.accumulatedExpenses).toMatchObject({ monthToDate: '1114.00', yearToDate: '2014.00' });
    expect(m.balanceProjection.endOfMonth).toBe('2986.00');
  });
});
