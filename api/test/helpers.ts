import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
export type Api = Awaited<ReturnType<typeof newUser>>;

/** Cria um usuário isolado e devolve um helper de requisição autenticada. */
export async function newUser(app: FastifyInstance) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { name: 'Teste', email: `u-${randomUUID()}@exemplo.com`, password: 'senha-forte-123' },
  });
  expect(res.statusCode).toBe(201);
  const { token } = res.json() as { token: string };
  const call = (method: Method, url: string, payload?: unknown) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      headers: { authorization: `Bearer ${token}` },
      ...(payload !== undefined && { payload: payload as object }),
    });
  return Object.assign(call, { token });
}

/** Faz a requisição e falha o teste com o corpo do erro se o status não for o esperado. */
export async function ok<T = any>(promise: ReturnType<Api>, status = 200): Promise<T> {
  const res = await promise;
  if (res.statusCode !== status) throw new Error(`HTTP ${res.statusCode} (esperado ${status}): ${res.body}`);
  return (res.body ? res.json() : null) as T;
}

export async function createAccount(api: Api, body: object = {}) {
  return ok(
    api('POST', '/accounts', {
      name: `Conta ${randomUUID().slice(0, 8)}`,
      type: 'checking',
      initialBalance: '1000.00',
      ...body,
    }),
    201,
  );
}

export async function categoryId(api: Api, name: string): Promise<string> {
  const { data } = await ok(api('GET', '/categories'));
  const found = data.find((c: { name: string }) => c.name === name);
  if (!found) throw new Error(`Categoria ${name} não encontrada`);
  return found.id;
}
