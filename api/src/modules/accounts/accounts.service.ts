import { and, asc, eq, getTableColumns, sql } from 'drizzle-orm';
import type { Database, DbExecutor } from '../../db/client.js';
import { accounts, transactions } from '../../db/schema.js';
import { fromCents, normalizeMoney, toCents } from '../../lib/money.js';
import {
  AppError,
  PG_UNIQUE_VIOLATION,
  getPgError,
  notFound,
} from '../../shared/errors.js';
import type { AccountResponse, CreateAccountBody, UpdateAccountBody } from './accounts.schemas.js';

type AccountRow = typeof accounts.$inferSelect;

export class AccountsService {
  constructor(private readonly db: Database) {}

  async create(userId: string, input: CreateAccountBody): Promise<AccountResponse> {
    const row = await this.handleNameConflict(async () => {
      const [created] = await this.db
        .insert(accounts)
        .values({
          userId,
          name: input.name,
          type: input.type,
          initialBalance: normalizeMoney(input.initialBalance),
          currency: input.currency,
          color: input.color ?? null,
        })
        .returning();
      return created!;
    });
    return toAccountResponse(row, { completed: '0', pending: '0' });
  }

  async list(userId: string, { includeInactive }: { includeInactive: boolean }) {
    const rows = await this.queryWithBalances(
      and(eq(accounts.userId, userId), includeInactive ? undefined : eq(accounts.isActive, true)),
    );
    const data = rows.map(({ completed, pending, ...account }) =>
      toAccountResponse(account, { completed, pending }),
    );
    return { data, totals: { byCurrency: totalsByCurrency(data) } };
  }

  async getById(userId: string, accountId: string): Promise<AccountResponse> {
    const [row] = await this.queryWithBalances(
      and(eq(accounts.id, accountId), eq(accounts.userId, userId)),
    );
    if (!row) throw notFound('Conta');
    const { completed, pending, ...account } = row;
    return toAccountResponse(account, { completed, pending });
  }

  async update(userId: string, accountId: string, input: UpdateAccountBody) {
    const updated = await this.handleNameConflict(async () => {
      const [row] = await this.db
        .update(accounts)
        .set({
          ...input,
          ...(input.initialBalance !== undefined && {
            initialBalance: normalizeMoney(input.initialBalance),
          }),
        })
        .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
        .returning({ id: accounts.id });
      return row;
    });
    if (!updated) throw notFound('Conta');
    return this.getById(userId, accountId);
  }

  /**
   * Contas nunca são apagadas fisicamente: o histórico do livro-caixa depende delas.
   * "Excluir" = arquivar (some das listagens, lançamentos continuam íntegros).
   */
  async archive(userId: string, accountId: string) {
    const [row] = await this.db
      .update(accounts)
      .set({ isActive: false })
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
      .returning({ id: accounts.id });
    if (!row) throw notFound('Conta');
  }

  /**
   * Garante que a conta existe, pertence ao usuário e está ativa.
   * Usado por outros módulos (transações, transferências) dentro de suas transações de banco.
   * `forUpdate` trava a linha para serializar operações concorrentes na mesma conta.
   */
  static async requireActiveAccount(
    db: DbExecutor,
    userId: string,
    accountId: string,
    opts: { forUpdate?: boolean } = {},
  ): Promise<AccountRow> {
    const query = db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
      .limit(1);
    const [account] = opts.forUpdate ? await query.for('update') : await query;

    if (!account) throw notFound('Conta');
    if (!account.isActive) {
      throw new AppError(422, 'BUSINESS_RULE', 'Conta arquivada não aceita lançamentos', {
        accountId,
      });
    }
    return account;
  }

  // ─── internos ──────────────────────────────────────────────────────────────

  private queryWithBalances(where: ReturnType<typeof and>) {
    return this.db
      .select({
        ...getTableColumns(accounts),
        completed: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.status} = 'completed'), 0)`,
        pending: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.status} = 'pending'), 0)`,
      })
      .from(accounts)
      .leftJoin(transactions, eq(transactions.accountId, accounts.id))
      .where(where)
      .groupBy(accounts.id)
      .orderBy(asc(accounts.name));
  }

  private async handleNameConflict<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const pg = getPgError(err);
      if (pg?.code === PG_UNIQUE_VIOLATION && pg.constraint === 'accounts_user_name_uq') {
        throw new AppError(409, 'CONFLICT', 'Já existe uma conta com esse nome');
      }
      throw err;
    }
  }
}

function toAccountResponse(
  row: AccountRow,
  sums: { completed: string; pending: string },
): AccountResponse {
  const balance = toCents(normalizeMoney(row.initialBalance)) + toCents(normalizeMoney(sums.completed));
  const pending = toCents(normalizeMoney(sums.pending));
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    currency: row.currency,
    color: row.color,
    isActive: row.isActive,
    initialBalance: normalizeMoney(row.initialBalance),
    balance: fromCents(balance),
    pendingAmount: fromCents(pending),
    projectedBalance: fromCents(balance + pending),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function totalsByCurrency(data: AccountResponse[]) {
  const map = new Map<string, { balance: bigint; projected: bigint }>();
  for (const acc of data) {
    const current = map.get(acc.currency) ?? { balance: 0n, projected: 0n };
    current.balance += toCents(acc.balance);
    current.projected += toCents(acc.projectedBalance);
    map.set(acc.currency, current);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, t]) => ({
      currency,
      balance: fromCents(t.balance),
      projectedBalance: fromCents(t.projected),
    }));
}
