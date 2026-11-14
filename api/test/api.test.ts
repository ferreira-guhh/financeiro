import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp(env);
});
afterAll(async () => {
  await app.close();
});

/** Cria um usuário isolado e devolve um helper de requisição autenticada. */
async function newUser() {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { name: 'Teste', email: `u-${randomUUID()}@exemplo.com`, password: 'senha-forte-123' },
  });
  expect(res.statusCode).toBe(201);
  const { token } = res.json();
  return (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      headers: { authorization: `Bearer ${token}` },
      ...(payload !== undefined && { payload: payload as object }),
    });
}

async function createAccount(api: Awaited<ReturnType<typeof newUser>>, body: object = {}) {
  const res = await api('POST', '/accounts', {
    name: `Conta ${randomUUID().slice(0, 8)}`,
    type: 'checking',
    initialBalance: '1000.00',
    ...body,
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

describe('auth', () => {
  it('bloqueia rotas sem token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/accounts' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  it('registra, faz login e rejeita e-mail duplicado (case-insensitive)', async () => {
    const email = `Dup-${randomUUID()}@Exemplo.com`;
    const payload = { name: 'Ana', email, password: 'senha-forte-123' };
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload })).statusCode).toBe(201);
    const dup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { ...payload, email: email.toUpperCase() },
    });
    expect(dup.statusCode).toBe(409);

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: 'senha-forte-123' },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().user.email).toBe(email.toLowerCase());

    const wrong = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: 'errada-errada' },
    });
    expect(wrong.statusCode).toBe(401);
  });
});

describe('accounts', () => {
  it('cria conta e calcula saldo a partir do saldo inicial', async () => {
    const api = await newUser();
    const account = await createAccount(api, { initialBalance: '1500.5' });
    expect(account.initialBalance).toBe('1500.50');
    expect(account.balance).toBe('1500.50');
    expect(account.currency).toBe('BRL');
  });

  it('valida dinheiro como string e rejeita float JSON', async () => {
    const api = await newUser();
    const asNumber = await api('POST', '/accounts', { name: 'X', type: 'checking', initialBalance: 10.5 });
    expect(asNumber.statusCode).toBe(400);
    expect(asNumber.json().error.details.issues[0].path).toBe('initialBalance');

    const tooManyDecimals = await api('POST', '/accounts', {
      name: 'Y',
      type: 'checking',
      initialBalance: '10.555',
    });
    expect(tooManyDecimals.statusCode).toBe(400);

    const cardType = await api('POST', '/accounts', { name: 'Z', type: 'credit_card' });
    expect(cardType.statusCode).toBe(400);
  });

  it('impede nome duplicado e isola contas entre usuários', async () => {
    const api = await newUser();
    const other = await newUser();
    const account = await createAccount(api, { name: 'Nubank' });
    expect((await api('POST', '/accounts', { name: 'Nubank', type: 'checking' })).statusCode).toBe(409);
    // Outro usuário pode usar o mesmo nome e não enxerga a conta alheia.
    expect((await other('POST', '/accounts', { name: 'Nubank', type: 'checking' })).statusCode).toBe(201);
    expect((await other('GET', `/accounts/${account.id}`)).statusCode).toBe(404);
  });

  it('arquiva em vez de apagar e bloqueia novos lançamentos', async () => {
    const api = await newUser();
    const account = await createAccount(api);
    expect((await api('DELETE', `/accounts/${account.id}`)).statusCode).toBe(204);
    expect((await api('GET', '/accounts')).json().data).toHaveLength(0);
    expect((await api('GET', '/accounts?includeInactive=true')).json().data).toHaveLength(1);

    const tx = await api('POST', '/transactions', {
      accountId: account.id,
      type: 'expense',
      amount: '10.00',
      date: '2026-11-01',
      description: 'Teste',
    });
    expect(tx.statusCode).toBe(422);
  });
});

describe('transactions', () => {
  it('aplica sinal pelo tipo e atualiza saldos (concluído vs pendente)', async () => {
    const api = await newUser();
    const account = await createAccount(api, { initialBalance: '100.00' });

    const income = await api('POST', '/transactions', {
      accountId: account.id,
      type: 'income',
      amount: '0.10',
      date: '2026-11-01',
      description: 'Rendimento',
    });
    expect(income.statusCode).toBe(201);
    expect(income.json().amount).toBe('0.10');

    const expense = await api('POST', '/transactions', {
      accountId: account.id,
      type: 'expense',
      amount: '0.20',
      date: '2026-11-02',
      description: 'Tarifa',
    });
    expect(expense.json().amount).toBe('-0.20');

    await api('POST', '/transactions', {
      accountId: account.id,
      type: 'expense',
      amount: '50',
      date: '2026-11-20',
      description: 'Boleto agendado',
      status: 'pending',
    });

    const after = (await api('GET', `/accounts/${account.id}`)).json();
    expect(after.balance).toBe('99.90'); // 100 + 0.10 − 0.20, sem erro de float
    expect(after.pendingAmount).toBe('-50.00');
    expect(after.projectedBalance).toBe('49.90');
  });

  it('detecta duplicidade pelo fingerprint e permite com allowDuplicate', async () => {
    const api = await newUser();
    const account = await createAccount(api);
    const body = {
      accountId: account.id,
      type: 'expense',
      amount: '7.50',
      date: '2026-11-05',
      description: 'Café',
      rawDescription: 'PADARIA SÃO JOÃO',
    };

    const first = await api('POST', '/transactions', body);
    expect(first.statusCode).toBe(201);

    // Mesma origem com variação cosmética na descrição bruta → duplicata.
    const dup = await api('POST', '/transactions', { ...body, rawDescription: 'padaria  sao joao' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('DUPLICATE_TRANSACTION');
    expect(dup.json().error.details.existingTransactionId).toBe(first.json().id);

    const second = await api('POST', '/transactions', { ...body, allowDuplicate: true });
    const third = await api('POST', '/transactions', { ...body, allowDuplicate: true });
    expect(second.statusCode).toBe(201);
    expect(third.statusCode).toBe(201);
    expect(new Set([first, second, third].map((r) => r.json().fingerprint)).size).toBe(3);
  });

  it('é idempotente sob requisições concorrentes', async () => {
    const api = await newUser();
    const account = await createAccount(api);
    const body = {
      accountId: account.id,
      type: 'expense',
      amount: '99.99',
      date: '2026-11-06',
      description: 'Compra concorrente',
    };
    const results = await Promise.all(Array.from({ length: 8 }, () => api('POST', '/transactions', body)));
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(7);
  });

  it('valida categoria (tipo compatível) e aceita categorias do sistema', async () => {
    const api = await newUser();
    const account = await createAccount(api);
    const cats = (await api('GET', '/categories')).json().data as Array<{ id: string; name: string; type: string }>;
    const salario = cats.find((c) => c.name === 'Salário')!;
    const mercado = cats.find((c) => c.name === 'Supermercado')!;

    const wrong = await api('POST', '/transactions', {
      accountId: account.id,
      type: 'expense',
      amount: '10.00',
      date: '2026-11-01',
      description: 'Errado',
      categoryId: salario.id,
    });
    expect(wrong.statusCode).toBe(422);

    const ok = await api('POST', '/transactions', {
      accountId: account.id,
      type: 'expense',
      amount: '230.45',
      date: '2026-11-01',
      description: 'Mercado',
      categoryId: mercado.id,
      paymentMethod: 'debit_card',
    });
    expect(ok.statusCode).toBe(201);
  });

  it('não permite lançar em conta de outro usuário', async () => {
    const api = await newUser();
    const other = await newUser();
    const account = await createAccount(api);
    const res = await other('POST', '/transactions', {
      accountId: account.id,
      type: 'income',
      amount: '1000000.00',
      date: '2026-11-01',
      description: 'Invasão',
    });
    expect(res.statusCode).toBe(404);
  });

  it('edita sem alterar o fingerprint e cancela (soft delete)', async () => {
    const api = await newUser();
    const account = await createAccount(api, { initialBalance: '0' });
    const created = (
      await api('POST', '/transactions', {
        accountId: account.id,
        type: 'expense',
        amount: '10.00',
        date: '2026-11-01',
        description: 'Uber',
      })
    ).json();

    const updated = await api('PATCH', `/transactions/${created.id}`, {
      amount: '12.30',
      description: 'Uber — aeroporto',
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().amount).toBe('-12.30');
    expect(updated.json().fingerprint).toBe(created.fingerprint);
    expect(updated.json().rawDescription).toBe('Uber');

    expect((await api('DELETE', `/transactions/${created.id}`)).statusCode).toBe(204);
    expect((await api('DELETE', `/transactions/${created.id}`)).statusCode).toBe(204); // idempotente
    expect((await api('GET', `/accounts/${account.id}`)).json().balance).toBe('0.00');
    expect((await api('GET', `/transactions/${created.id}`)).json().status).toBe('cancelled');
    expect((await api('PATCH', `/transactions/${created.id}`, { notes: 'x' })).statusCode).toBe(422);
  });

  it('pagina por cursor de forma estável e filtra', async () => {
    const api = await newUser();
    const account = await createAccount(api);
    for (let day = 1; day <= 7; day++) {
      await api('POST', '/transactions', {
        accountId: account.id,
        type: 'expense',
        amount: `${day}.00`,
        date: `2026-10-0${day}`,
        description: day % 2 ? 'Mercado 100% natural' : 'Farmácia',
      });
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const qs: string = `/transactions?limit=3${cursor ? `&cursor=${cursor}` : ''}`;
      const page = (await api('GET', qs)).json();
      seen.push(...page.data.map((t: { date: string }) => t.date));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual([...seen].sort().reverse());
    expect(seen).toHaveLength(7);

    const filtered = (await api('GET', '/transactions?search=100%25&from=2026-10-02&to=2026-10-06')).json();
    expect(filtered.data.map((t: { date: string }) => t.date)).toEqual(['2026-10-05', '2026-10-03']);

    expect((await api('GET', '/transactions?cursor=lixo')).statusCode).toBe(400);
  });
});

describe('transfers', () => {
  it('cria duas pernas atômicas que somam zero e cancela as duas juntas', async () => {
    const api = await newUser();
    const corrente = await createAccount(api, { initialBalance: '1000.00' });
    const poupanca = await createAccount(api, { type: 'savings', initialBalance: '0' });

    const res = await api('POST', '/transfers', {
      fromAccountId: corrente.id,
      toAccountId: poupanca.id,
      amount: '250.00',
      date: '2026-11-08',
    });
    expect(res.statusCode).toBe(201);
    const transfer = res.json();
    expect(transfer.from.amount).toBe('-250.00');
    expect(transfer.to.amount).toBe('250.00');
    expect(transfer.from.transferId).toBe(transfer.to.transferId);

    const list = (await api('GET', '/accounts')).json();
    expect(list.totals.byCurrency).toEqual([
      { currency: 'BRL', balance: '1000.00', projectedBalance: '1000.00' },
    ]);

    // Editar valor de uma perna isolada quebraria o par → bloqueado.
    expect((await api('PATCH', `/transactions/${transfer.to.id}`, { amount: '1.00' })).statusCode).toBe(422);

    expect((await api('DELETE', `/transactions/${transfer.to.id}`)).statusCode).toBe(204);
    expect((await api('GET', `/transactions/${transfer.from.id}`)).json().status).toBe('cancelled');
    expect((await api('GET', `/accounts/${corrente.id}`)).json().balance).toBe('1000.00');
  });

  it('rejeita transferência para a mesma conta e entre moedas diferentes', async () => {
    const api = await newUser();
    const brl = await createAccount(api);
    const usd = await createAccount(api, { currency: 'usd' });
    const same = await api('POST', '/transfers', {
      fromAccountId: brl.id,
      toAccountId: brl.id,
      amount: '1.00',
      date: '2026-11-08',
    });
    expect(same.statusCode).toBe(400);
    const fx = await api('POST', '/transfers', {
      fromAccountId: brl.id,
      toAccountId: usd.id,
      amount: '1.00',
      date: '2026-11-08',
    });
    expect(fx.statusCode).toBe(422);
  });
});
