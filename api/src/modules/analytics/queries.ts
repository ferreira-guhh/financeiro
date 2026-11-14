/**
 * Agregações reutilizáveis do livro-caixa (dashboard, relatórios, métricas, simulações).
 *
 * Regras contábeis aplicadas em TODAS as consultas:
 * - Só transações `completed` entram no "realizado" (pendentes são previsão).
 * - Transferências não são receita nem despesa (inclui pagamento de fatura e aportes em investimento).
 * - Compras no cartão contam como despesa na data da compra (competência), não no pagamento da fatura.
 * - Estorno no cartão (income em conta de cartão) reduz a despesa, não vira receita.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client.js';
import { accounts, categories, investments, transactions } from '../../db/schema.js';
import { monthEnd } from '../../domain/dates.js';
import { normalizeMoney, toCents } from '../../lib/money.js';

const c = (v: string | null | undefined) => toCents(normalizeMoney(v ?? '0'));

export const LIQUID_TYPES = ['checking', 'savings', 'wallet', 'other'] as const;
const liquidList = sql.raw(LIQUID_TYPES.map((t) => `'${t}'`).join(','));

/** Expressões SQL das métricas (sobre transactions t JOIN accounts a). */
const INCOME = sql`coalesce(sum(t.amount) filter (where t.type = 'income' and a.type <> 'credit_card'), 0)`;
const EXPENSE = sql`coalesce(-sum(t.amount) filter (where t.type = 'expense' or (t.type = 'income' and a.type = 'credit_card')), 0)`;

function realized(userId: string, from: string, to: string, extra?: SQL) {
  return sql`t.user_id = ${userId} and t.status = 'completed' and t.type <> 'transfer'
    and t.date between ${from}::date and ${to}::date ${extra ? sql`and ${extra}` : sql``}`;
}

export interface Flows {
  incomeCents: bigint;
  expenseCents: bigint;
}

export async function periodFlows(db: DbExecutor, userId: string, from: string, to: string): Promise<Flows> {
  const { rows } = await db.execute<{ income: string; expense: string }>(sql`
    select ${INCOME} as income, ${EXPENSE} as expense
    from ${transactions} t join ${accounts} a on a.id = t.account_id
    where ${realized(userId, from, to)}`);
  return { incomeCents: c(rows[0]?.income), expenseCents: c(rows[0]?.expense) };
}

export interface MonthFlows extends Flows {
  /** Receita vinda de recorrências (receita fixa). */
  fixedIncomeCents: bigint;
  /** Despesas geradas por recorrências (fixas). */
  recurringExpenseCents: bigint;
  /** Despesas de parcelas. */
  installmentExpenseCents: bigint;
  /** Despesas em categorias essenciais. */
  essentialExpenseCents: bigint;
}

export async function monthlyFlows(
  db: DbExecutor,
  userId: string,
  fromMonth: string,
  toMonth: string,
): Promise<Map<string, MonthFlows>> {
  const { rows } = await db.execute<Record<string, string>>(sql`
    select to_char(t.date, 'YYYY-MM') as month,
      ${INCOME} as income,
      ${EXPENSE} as expense,
      coalesce(sum(t.amount) filter (where t.type = 'income' and a.type <> 'credit_card' and t.recurring_transaction_id is not null), 0) as fixed_income,
      coalesce(-sum(t.amount) filter (where t.type = 'expense' and t.recurring_transaction_id is not null), 0) as recurring_expense,
      coalesce(-sum(t.amount) filter (where t.type = 'expense' and t.source = 'installment'), 0) as installment_expense,
      coalesce(-sum(t.amount) filter (where t.type = 'expense' and cat.is_essential), 0) as essential_expense
    from ${transactions} t
    join ${accounts} a on a.id = t.account_id
    left join ${categories} cat on cat.id = t.category_id
    where ${realized(userId, `${fromMonth}-01`, monthEnd(toMonth))}
    group by 1`);
  return new Map(
    rows.map((r) => [
      r.month!,
      {
        incomeCents: c(r.income),
        expenseCents: c(r.expense),
        fixedIncomeCents: c(r.fixed_income),
        recurringExpenseCents: c(r.recurring_expense),
        installmentExpenseCents: c(r.installment_expense),
        essentialExpenseCents: c(r.essential_expense),
      },
    ]),
  );
}

/** Despesa variável realizada (não recorrente e não parcela) num período. */
export async function variableExpense(db: DbExecutor, userId: string, from: string, to: string): Promise<bigint> {
  const { rows } = await db.execute<{ total: string }>(sql`
    select ${EXPENSE} as total
    from ${transactions} t join ${accounts} a on a.id = t.account_id
    where ${realized(userId, from, to, sql`t.recurring_transaction_id is null and t.source <> 'installment'`)}`);
  return c(rows[0]?.total);
}

export interface CategoryTotal {
  categoryId: string | null;
  name: string;
  color: string | null;
  icon: string | null;
  parentId: string | null;
  isEssential: boolean;
  totalCents: bigint;
  count: number;
}

/**
 * Totais por categoria. `rollup=true` agrega subcategorias na categoria pai
 * (ex.: Supermercado + Delivery → Alimentação).
 */
export async function categoryTotals(
  db: DbExecutor,
  userId: string,
  from: string,
  to: string,
  type: 'income' | 'expense',
  rollup: boolean,
): Promise<CategoryTotal[]> {
  const key = rollup ? sql`coalesce(cat.parent_id, cat.id)` : sql`cat.id`;
  const amount =
    type === 'expense'
      ? sql`-sum(t.amount) filter (where t.type = 'expense' or (t.type = 'income' and a.type = 'credit_card'))`
      : sql`sum(t.amount) filter (where t.type = 'income' and a.type <> 'credit_card')`;
  const { rows } = await db.execute<Record<string, string | number | boolean | null>>(sql`
    select ${key} as category_id, coalesce(${amount}, 0) as total,
      count(*) filter (where ${type === 'expense' ? sql`t.type = 'expense'` : sql`t.type = 'income' and a.type <> 'credit_card'`})::int as count
    from ${transactions} t
    join ${accounts} a on a.id = t.account_id
    left join ${categories} cat on cat.id = t.category_id
    where ${realized(userId, from, to)}
    group by 1
    having coalesce(${amount}, 0) <> 0`);

  const ids = rows.map((r) => r.category_id).filter((x): x is string => typeof x === 'string');
  const meta = ids.length
    ? await db.execute<{ id: string; name: string; color: string | null; icon: string | null; parent_id: string | null; is_essential: boolean }>(
        sql`select id, name, color, icon, parent_id, is_essential from ${categories} where id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`,
      )
    : { rows: [] };
  const byId = new Map(meta.rows.map((m) => [m.id, m]));

  return rows
    .map((r) => {
      const m = r.category_id ? byId.get(r.category_id as string) : undefined;
      return {
        categoryId: (r.category_id as string | null) ?? null,
        name: m?.name ?? 'Sem categoria',
        color: m?.color ?? null,
        icon: m?.icon ?? null,
        parentId: m?.parent_id ?? null,
        isEssential: m?.is_essential ?? false,
        totalCents: c(String(r.total)),
        count: Number(r.count),
      };
    })
    .sort((a, b) => (b.totalCents > a.totalCents ? 1 : b.totalCents < a.totalCents ? -1 : 0));
}

export async function topExpenses(db: DbExecutor, userId: string, from: string, to: string, limit: number) {
  const { rows } = await db.execute<{ id: string; date: string; description: string; amount: string; category_id: string | null; category_name: string | null }>(sql`
    select t.id, to_char(t.date, 'YYYY-MM-DD') as date, t.description, -t.amount as amount, t.category_id, cat.name as category_name
    from ${transactions} t
    join ${accounts} a on a.id = t.account_id
    left join ${categories} cat on cat.id = t.category_id
    where ${realized(userId, from, to, sql`t.type = 'expense'`)}
    order by t.amount asc, t.date desc
    limit ${limit}`);
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    description: r.description,
    amount: normalizeMoney(r.amount),
    categoryId: r.category_id,
    categoryName: r.category_name,
  }));
}

export interface Balances {
  liquidCents: bigint;
  investmentAccountsCents: bigint;
  cardDebtCents: bigint;
  netWorthCents: bigint;
}

/**
 * Saldos realizados no fim do dia `asOf` (somente transações concluídas).
 * O saldo inicial da conta é tratado como existente desde o início do histórico.
 */
export async function balancesAsOf(db: DbExecutor, userId: string, asOf: string): Promise<Balances> {
  const { rows } = await db.execute<{ type: string; balance: string }>(sql`
    select a.type, sum(a.initial_balance + coalesce((
      select sum(t.amount) from ${transactions} t
      where t.account_id = a.id and t.status = 'completed' and t.date <= ${asOf}::date), 0)) as balance
    from ${accounts} a
    where a.user_id = ${userId}
    group by a.type`);
  let liquid = 0n;
  let invest = 0n;
  let card = 0n;
  for (const r of rows) {
    const v = c(r.balance);
    if (r.type === 'investment') invest += v;
    else if (r.type === 'credit_card') card += v;
    else liquid += v;
  }
  return { liquidCents: liquid, investmentAccountsCents: invest, cardDebtCents: card < 0n ? -card : 0n, netWorthCents: liquid + invest + card };
}

/** Saldo líquido (contas de movimento) dia a dia, para o gráfico de evolução do saldo. */
export async function dailyLiquidBalance(db: DbExecutor, userId: string, from: string, to: string) {
  const { rows } = await db.execute<{ day: string; balance: string }>(sql`
    with base as (
      select coalesce(sum(a.initial_balance), 0) as initial from ${accounts} a
      where a.user_id = ${userId} and a.type in (${liquidList})
    ),
    daily as (
      select t.date as day, sum(t.amount) as delta
      from ${transactions} t join ${accounts} a on a.id = t.account_id
      where t.user_id = ${userId} and t.status = 'completed' and a.type in (${liquidList}) and t.date <= ${to}::date
      group by t.date
    ),
    before as (select coalesce(sum(delta), 0) as total from daily where day < ${from}::date)
    select to_char(d.day, 'YYYY-MM-DD') as day,
      (select initial from base) + (select total from before)
        + coalesce(sum(daily.delta) over (order by d.day), 0) as balance
    from generate_series(${from}::date, ${to}::date, interval '1 day') as d(day)
    left join daily on daily.day = d.day
    order by d.day`);
  return rows.map((r) => ({ date: r.day, balance: normalizeMoney(r.balance) }));
}

/** Aportes líquidos em contas de investimento (transferências entrando − saindo). */
export async function netInvested(db: DbExecutor, userId: string, from: string, to: string): Promise<bigint> {
  const { rows } = await db.execute<{ total: string }>(sql`
    select coalesce(sum(t.amount), 0) as total
    from ${transactions} t join ${accounts} a on a.id = t.account_id
    where t.user_id = ${userId} and t.status = 'completed' and t.type = 'transfer'
      and a.type = 'investment' and t.date between ${from}::date and ${to}::date`);
  return c(rows[0]?.total);
}

/** Posições de investimento cadastradas que NÃO estão dentro de uma conta (evita contar duas vezes). */
export async function unlinkedInvestmentsValue(db: DbExecutor, userId: string): Promise<bigint> {
  const { rows } = await db.execute<{ total: string }>(sql`
    select coalesce(sum(coalesce(i.current_amount, i.invested_amount)), 0) as total
    from ${investments} i
    where i.user_id = ${userId} and i.status = 'active' and i.account_id is null`);
  return c(rows[0]?.total);
}

/** % com 2 casas: part/total. */
export function percent(part: bigint, total: bigint): string {
  if (total === 0n) return '0.00';
  const scaled = (part * 100_000n) / total; // 3 casas para arredondar
  const rounded = scaled >= 0n ? (scaled + 5n) / 10n : (scaled - 5n) / 10n;
  const neg = rounded < 0n;
  const abs = neg ? -rounded : rounded;
  return `${neg ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

/** Variação % de `previous` para `current` (null se não havia base). */
export function change(current: bigint, previous: bigint): string | null {
  if (previous === 0n) return null;
  return percent(current - previous, previous < 0n ? -previous : previous);
}
