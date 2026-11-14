/**
 * Fase 2 — cartões, faturas, parcelamentos, recorrências, metas, investimentos.
 * Relógio congelado em 2026-11-15 (vitest.config.ts).
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { categoryId, createAccount, newUser, ok, type Api } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp(env);
});
afterAll(async () => {
  await app.close();
});

async function setupCard(api: Api) {
  const checking = await createAccount(api, { name: 'Corrente', initialBalance: '10000.00' });
  const card = await ok(
    api('POST', '/credit-cards', {
      name: 'Nubank',
      creditLimit: '5000.00',
      closingDay: 3,
      dueDay: 10,
      paymentAccountId: checking.id,
    }),
    201,
  );
  return { checking, card };
}

describe('cartões e faturas', () => {
  it('distribui compras nas faturas certas e calcula o limite disponível com parcelas futuras', async () => {
    const api = await newUser(app);
    const { card } = await setupCard(api);
    expect(card.currentInvoice.key).toBe('2026-12'); // hoje 15/11, após o fechamento de 03/11

    await ok(api('POST', `/credit-cards/${card.id}/purchases`, { description: 'Mercado', amount: '200.00', date: '2026-11-10' }), 201);
    const plan = await ok(
      api('POST', `/credit-cards/${card.id}/purchases`, {
        description: 'Notebook',
        amount: '3600.00',
        installments: 12,
        date: '2026-11-12',
        categoryId: await categoryId(api, 'Compras'),
      }),
      201,
    );
    expect(plan.kind).toBe('installment_plan');

    const after = await ok(api('GET', `/credit-cards/${card.id}`));
    expect(after.usedLimit).toBe('3800.00'); // 200 + 300 lançada + 3.300 agendadas
    expect(after.availableLimit).toBe('1200.00');
    expect(after.currentInvoice.total).toBe('500.00');

    const { data: invoices } = await ok(api('GET', `/credit-cards/${card.id}/invoices`));
    const byKey = Object.fromEntries(invoices.map((i: any) => [i.key, i]));
    expect(byKey['2027-01'].total).toBe('300.00');
    expect(byKey['2027-01'].scheduled).toBe('300.00');
    expect(byKey['2027-11'].total).toBe('300.00');

    const detail = await ok(api('GET', `/credit-cards/${card.id}/invoices/2027/2`));
    expect(detail.items).toEqual([expect.objectContaining({ kind: 'scheduled_installment', description: 'Notebook (3/12)', amount: '300.00' })]);
  });

  it('fatura vencida → pagamento a marca como paga e debita a conta pagadora', async () => {
    const api = await newUser(app);
    const { checking, card } = await setupCard(api);
    await ok(api('POST', `/credit-cards/${card.id}/purchases`, { description: 'Farmácia', amount: '150.40', date: '2026-11-02' }), 201);

    let inv = await ok(api('GET', `/credit-cards/${card.id}/invoices/2026/11`));
    expect(inv).toMatchObject({ closingDate: '2026-11-03', dueDate: '2026-11-10', status: 'overdue', remaining: '150.40' });

    inv = await ok(api('POST', `/credit-cards/${card.id}/invoices/2026/11/payments`, { date: '2026-11-15' }), 201);
    expect(inv).toMatchObject({ status: 'paid', paid: '150.40', remaining: '0.00' });
    expect(inv.items.map((i: any) => i.kind)).toEqual(['transaction', 'payment']);

    const acc = await ok(api('GET', `/accounts/${checking.id}`));
    expect(acc.balance).toBe('9849.60');
    const cardAcc = await ok(api('GET', `/credit-cards/${card.id}`));
    expect(cardAcc.usedLimit).toBe('0.00');

    // Pagar de novo: nada a pagar.
    expect((await api('POST', `/credit-cards/${card.id}/invoices/2026/11/payments`, { date: '2026-11-15' })).statusCode).toBe(422);
  });

  it('transferência para o cartão vira pagamento da fatura fechada mais antiga', async () => {
    const api = await newUser(app);
    const { checking, card } = await setupCard(api);
    await ok(api('POST', `/credit-cards/${card.id}/purchases`, { description: 'Posto', amount: '100.00', date: '2026-11-01' }), 201);
    await ok(api('POST', '/transfers', { fromAccountId: checking.id, toAccountId: card.accountId, amount: '100.00', date: '2026-11-14' }), 201);
    const inv = await ok(api('GET', `/credit-cards/${card.id}/invoices/2026/11`));
    expect(inv.status).toBe('paid');
  });

  it('protege faturas fechadas: não altera nem cancela, só estorno', async () => {
    const api = await newUser(app);
    const { card } = await setupCard(api);
    const closed = await ok(api('POST', `/credit-cards/${card.id}/purchases`, { description: 'Antigo', amount: '80.00', date: '2026-11-01' }), 201);
    const open = await ok(api('POST', `/credit-cards/${card.id}/purchases`, { description: 'Novo', amount: '80.00', date: '2026-11-14' }), 201);

    expect((await api('PATCH', `/transactions/${closed.transaction.id}`, { amount: '1.00' })).statusCode).toBe(422);
    expect((await api('DELETE', `/transactions/${closed.transaction.id}`)).statusCode).toBe(422);
    expect((await api('PATCH', `/transactions/${closed.transaction.id}`, { description: 'Renomear pode' })).statusCode).toBe(200);
    expect((await api('PATCH', `/transactions/${open.transaction.id}`, { amount: '90.00' })).statusCode).toBe(200);

    const refund = await ok(api('POST', `/credit-cards/${card.id}/purchases`, { description: 'Estorno Antigo', type: 'income', amount: '80.00', date: '2026-11-15' }), 201);
    expect(refund.transaction.amount).toBe('80.00');
    const inv = await ok(api('GET', `/credit-cards/${card.id}/invoices/2026/12`));
    expect(inv.total).toBe('10.00'); // 90 − 80
  });

  it('lançamento manual direto na conta do cartão é bloqueado', async () => {
    const api = await newUser(app);
    const { card } = await setupCard(api);
    const res = await api('POST', '/transactions', { accountId: card.accountId, type: 'expense', amount: '1.00', date: '2026-11-15', description: 'x' });
    expect(res.statusCode).toBe(422);
  });
});

describe('parcelamentos', () => {
  it('compra no passado lança só as parcelas vencidas e o processamento é idempotente', async () => {
    const api = await newUser(app);
    const { card } = await setupCard(api);
    const created = await ok(
      api('POST', `/credit-cards/${card.id}/purchases`, { description: 'Geladeira', amount: '100.00', installments: 6, date: '2026-08-20' }),
      201,
    );
    const plan = await ok(api('GET', `/installment-plans/${created.installmentPlanId}`));
    expect(plan).toMatchObject({ currentInstallment: 3, remainingCount: 3, firstInstallmentAmount: '16.70', installmentAmount: '16.66' });
    expect(plan.installments.map((i: any) => i.date)).toEqual(['2026-08-20', '2026-09-20', '2026-10-20', '2026-11-20', '2026-12-20', '2027-01-20']);
    expect(plan.postedAmount).toBe('50.02');
    expect(plan.remainingAmount).toBe('49.98');

    const run1 = await ok(api('POST', '/processing/run'));
    const run2 = await ok(api('POST', '/processing/run'));
    expect(run1.installmentsPosted).toBe(0);
    expect(run2.installmentsPosted).toBe(0);

    const { data } = await ok(api('GET', '/transactions?search=Geladeira'));
    expect(data).toHaveLength(3);
    expect(data.map((t: any) => t.description)).toContain('Geladeira (2/6)');
  });

  it('parcelamento com juros (valor da parcela) e carnê fora do cartão', async () => {
    const api = await newUser(app);
    const checking = await createAccount(api);
    const plan = await ok(
      api('POST', '/installment-plans', { accountId: checking.id, description: 'Curso', installmentAmount: '320.00', installmentCount: 3, purchaseDate: '2026-11-01' }),
      201,
    );
    expect(plan).toMatchObject({ totalAmount: '960.00', currentInstallment: 1 });
    const { data } = await ok(api('GET', '/transactions?search=Curso'));
    expect(data[0]).toMatchObject({ status: 'pending', amount: '-320.00', source: 'installment' });

    const schedule = await ok(api('GET', '/installment-plans/schedule?months=3'));
    expect(schedule.months.map((m: any) => m.total)).toEqual(['320.00', '320.00', '320.00']);
    expect(schedule.totalCommitted).toBe('960.00');
  });

  it('cancelar parcelamento cancela futuras e, se pedido, as lançadas em faturas abertas', async () => {
    const api = await newUser(app);
    const { card } = await setupCard(api);
    const created = await ok(
      api('POST', `/credit-cards/${card.id}/purchases`, { description: 'TV', amount: '1200.00', installments: 4, date: '2026-11-14' }),
      201,
    );
    // Parcela avulsa não pode ser cancelada isoladamente.
    const { data } = await ok(api('GET', '/transactions?search=TV'));
    expect((await api('DELETE', `/transactions/${data[0].id}`)).statusCode).toBe(422);

    await ok(api('DELETE', `/installment-plans/${created.installmentPlanId}?cancelPosted=true`), 204);
    const plan = await ok(api('GET', `/installment-plans/${created.installmentPlanId}`));
    expect(plan.status).toBe('cancelled');
    expect(plan.installments.every((i: any) => i.status === 'cancelled')).toBe(true);
    const cardNow = await ok(api('GET', `/credit-cards/${card.id}`));
    expect(cardNow.usedLimit).toBe('0.00');
  });
});

describe('recorrências', () => {
  it('gera a ocorrência do mês como pendente, projeta as próximas e não retroage antes do mês atual', async () => {
    const api = await newUser(app);
    const checking = await createAccount(api, { initialBalance: '0' });
    const rent = await ok(
      api('POST', '/recurring', {
        accountId: checking.id,
        type: 'expense',
        amount: '1500.00',
        description: 'Aluguel',
        dayOfMonth: 5,
        startDate: '2025-01-01',
        categoryId: await categoryId(api, 'Aluguel'),
      }),
      201,
    );
    expect(rent).toMatchObject({ lastGeneratedDate: '2026-11-15', nextOccurrence: '2026-12-05', monthlyEquivalent: '1500.00' });

    const salary = await ok(
      api('POST', '/recurring', { accountId: checking.id, type: 'income', amount: '6000.00', description: 'Salário', dayOfMonth: 5, startDate: '2026-11-01', autoConfirm: true }),
      201,
    );
    expect(salary.lastGeneratedDate).toBe('2026-11-15');

    const acc = await ok(api('GET', `/accounts/${checking.id}`));
    expect(acc).toMatchObject({ balance: '6000.00', pendingAmount: '-1500.00', projectedBalance: '4500.00' });

    const { data: upcoming } = await ok(api('GET', '/recurring/upcoming?days=60'));
    expect(upcoming.map((u: any) => [u.date, u.kind, u.amount])).toEqual([
      ['2026-11-05', 'pending', '-1500.00'],
      ['2026-12-05', 'projected', '-1500.00'],
      ['2026-12-05', 'projected', '6000.00'],
      ['2027-01-05', 'projected', '-1500.00'],
      ['2027-01-05', 'projected', '6000.00'],
    ]);
    expect(upcoming[0].overdue).toBe(true);

    expect((await ok(api('POST', '/processing/run'))).recurringGenerated).toBe(0);
  });

  it('backfill gera o histórico como realizado e respeita o limite de 24 meses', async () => {
    const api = await newUser(app);
    const acc = await createAccount(api, { initialBalance: '0' });
    await ok(api('POST', '/recurring', { accountId: acc.id, type: 'expense', amount: '100.00', description: 'Academia', dayOfMonth: 10, startDate: '2026-08-01', backfill: true }), 201);
    const { data } = await ok(api('GET', '/transactions?search=Academia'));
    expect(data.map((t: any) => [t.date, t.status])).toEqual([
      ['2026-11-10', 'completed'],
      ['2026-10-10', 'completed'],
      ['2026-09-10', 'completed'],
      ['2026-08-10', 'completed'],
    ]);
    expect((await api('POST', '/recurring', { accountId: acc.id, type: 'expense', amount: '1.00', description: 'Velho', startDate: '2023-01-01', backfill: true })).statusCode).toBe(422);
  });

  it('regras categorizam lançamentos manuais sem categoria', async () => {
    const api = await newUser(app);
    const acc = await createAccount(api);
    const delivery = await categoryId(api, 'Delivery');
    await ok(api('POST', '/category-rules', { categoryId: delivery, pattern: 'IFOOD' }), 201);
    const t = await ok(api('POST', '/transactions', { accountId: acc.id, type: 'expense', amount: '40.00', date: '2026-11-14', description: 'iFood almoço' }), 201);
    expect(t.categoryId).toBe(delivery);
    // Categoria escolhida pelo usuário sempre prevalece.
    const own = await ok(api('POST', '/transactions', { accountId: acc.id, type: 'expense', amount: '41.00', date: '2026-11-14', description: 'iFood mercado', categoryId: await categoryId(api, 'Supermercado') }), 201);
    expect(own.categoryId).not.toBe(delivery);
  });

  it('assinatura no cartão aparece como prevista na fatura', async () => {
    const api = await newUser(app);
    const { card } = await setupCard(api);
    await ok(
      api('POST', '/recurring', { accountId: card.accountId, type: 'expense', amount: '55.90', description: 'Netflix', dayOfMonth: 20, startDate: '2026-11-20' }),
      201,
    );
    const inv = await ok(api('GET', `/credit-cards/${card.id}/invoices/2026/12`));
    expect(inv.projectedRecurring).toBe('55.90');
    expect(inv.items[0]).toMatchObject({ kind: 'projected_recurring', date: '2026-11-20', amount: '55.90' });
  });

  it('identifica recorrências no histórico', async () => {
    const api = await newUser(app);
    const checking = await createAccount(api);
    for (const [date, amount] of [['2026-08-14', '21.90'], ['2026-09-14', '21.90'], ['2026-10-14', '23.90'], ['2026-11-14', '23.90']] as const) {
      await ok(api('POST', '/transactions', { accountId: checking.id, type: 'expense', amount, date, description: `SPOTIFY *${date.slice(5, 7)}88` }), 201);
    }
    await ok(api('POST', '/transactions', { accountId: checking.id, type: 'expense', amount: '300', date: '2026-10-02', description: 'Loja aleatória' }), 201);
    const { data } = await ok(api('GET', '/recurring/suggestions'));
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ dayOfMonth: 14, occurrences: 4, type: 'expense' });
  });
});

describe('metas', () => {
  it('calcula quanto falta, aporte necessário e previsão; registra aportes', async () => {
    const api = await newUser(app);
    const goal = await ok(
      api('POST', '/goals', { name: 'Reserva', kind: 'emergency_reserve', targetAmount: '10000.00', initialAmount: '1000.00', monthlyContribution: '500.00', targetDate: '2027-12-31' }),
      201,
    );
    expect(goal).toMatchObject({
      currentAmount: '1000.00',
      remainingAmount: '9000.00',
      progressPercent: '10.00',
      monthsLeft: 14,
      requiredMonthlyContribution: '642.86',
      forecastMonth: '2028-04',
      onTrack: false,
    });

    const updated = await ok(api('POST', `/goals/${goal.id}/contributions`, { amount: '1500.00', date: '2026-11-15' }), 201);
    expect(updated.currentAmount).toBe('2500.00');
    expect((await api('POST', `/goals/${goal.id}/contributions`, { amount: '-9000.00', date: '2026-11-15' })).statusCode).toBe(422);

    const proj = await ok(api('GET', `/goals/${goal.id}/projection?monthlyContribution=750.00`));
    expect(proj).toMatchObject({ months: 10, reachedMonth: '2027-08' });
    expect(proj.alternatives.map((a: any) => a.label)).toEqual(['−25%', 'Atual', '+25%', '+50%']);
  });

  it('meta vinculada a conta usa o saldo da conta', async () => {
    const api = await newUser(app);
    const savings = await createAccount(api, { type: 'savings', initialBalance: '3000.00' });
    const goal = await ok(api('POST', '/goals', { name: 'Viagem', targetAmount: '6000.00', linkedAccountId: savings.id }), 201);
    expect(goal.currentAmount).toBe('3000.00');
    expect(goal.progressPercent).toBe('50.00');
    expect((await api('POST', `/goals/${goal.id}/contributions`, { amount: '10.00', date: '2026-11-15' })).statusCode).toBe(422);
  });
});

describe('investimentos e configurações', () => {
  it('registra investimentos e resume por tipo e liquidez', async () => {
    const api = await newUser(app);
    await ok(api('POST', '/investments', { name: 'CDB Banco X', type: 'cdb', investedAmount: '5000.00', currentAmount: '5400.00', investedAt: '2026-01-10', rateDescription: '110% do CDI', liquidityDays: 0, maturityDate: '2027-01-10' }), 201);
    await ok(api('POST', '/investments', { name: 'Tesouro IPCA 2035', type: 'treasury', investedAmount: '2000.00', investedAt: '2026-03-01', maturityDate: '2035-05-15' }), 201);
    const summary = await ok(api('GET', '/investments/summary'));
    expect(summary).toMatchObject({ totalInvested: '7000.00', totalCurrent: '7400.00' });
    expect(summary.byLiquidity.map((b: any) => b.bucket)).toEqual(['daily', 'at_maturity']);
    const { data } = await ok(api('GET', '/investments'));
    expect(data.find((i: any) => i.type === 'cdb')).toMatchObject({ gain: '400.00', gainPercent: '8.00' });
  });

  it('salva parâmetros do gasto seguro', async () => {
    const api = await newUser(app);
    expect((await api('PUT', '/settings', { incomeBasis: 'fixed' })).statusCode).toBe(422);
    const s = await ok(api('PUT', '/settings', { incomeBasis: 'fixed', fixedMonthlyIncome: '5000.00', monthlyReserveAmount: '700.00' }));
    expect(s).toMatchObject({ incomeBasis: 'fixed', fixedMonthlyIncome: '5000.00', monthlyReserveAmount: '700.00', includeGoalContributions: true });
  });
});
