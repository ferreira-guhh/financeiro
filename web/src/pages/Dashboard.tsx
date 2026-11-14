import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { get, qs } from '../api/client';
import { categoryLabel, useCategories } from '../api/hooks';
import type { Dashboard, MonthPoint, SafeToSpend } from '../api/types';
import { CategoryBars, MoneyBarChart } from '../components/charts';
import { Badge, Button, Empty, ErrorNote, Loading, Money, ProgressBar, SectionTitle, cx } from '../components/ui';
import {
  currentMonth,
  formatBRL,
  formatDate,
  formatDayMonth,
  formatMonthLong,
  formatMonthTitle,
  formatMonthShort,
  formatPercent,
  isNegative,
  shiftMonth,
  toNumber,
} from '../lib/format';

const INVOICE_STATUS = {
  open: { label: 'Aberta', tone: 'neutral' },
  closed: { label: 'Fechada', tone: 'warn' },
  paid: { label: 'Paga', tone: 'pos' },
  overdue: { label: 'Vencida', tone: 'neg' },
} as const;

export function DashboardPage() {
  const [month, setMonth] = useState(currentMonth());
  const dash = useQuery({ queryKey: ['dashboard', month], queryFn: () => get<Dashboard>(`/dashboard${qs({ month })}`) });
  const series = useQuery({
    queryKey: ['analytics-monthly', month],
    queryFn: () => get<{ data: MonthPoint[] }>(`/analytics/monthly${qs({ from: shiftMonth(month, -5), to: month })}`),
  });
  const cats = useQuery({
    queryKey: ['analytics-categories', month],
    queryFn: () => get<{ total: string; categories: { name: string; total: string; share: string }[] }>(`/analytics/categories${qs({ from: `${month}-01`, to: `${month}${lastDay(month)}` })}`),
  });
  const { data: categories } = useCategories();
  const label = categoryLabel(categories);

  if (dash.isLoading) return <Loading />;
  if (dash.error || !dash.data) return <ErrorNote error={dash.error} />;
  const d = dash.data;
  const isCurrent = month === currentMonth();

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[26px] font-semibold tracking-[-0.01em]">Painel</h1>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mês anterior">
            ‹
          </Button>
          <span className="min-w-36 text-center text-sm font-medium">{formatMonthLong(month)}</span>
          <Button variant="ghost" size="sm" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Próximo mês">
            ›
          </Button>
          {!isCurrent && (
            <Button variant="ghost" size="sm" onClick={() => setMonth(currentMonth())}>
              Hoje
            </Button>
          )}
        </div>
      </div>

      <SafeToSpendHero s={d.safeToSpend} isCurrent={isCurrent} balances={d.balances} available={d.available} />

      <div className="grid gap-x-10 gap-y-10 lg:grid-cols-[1.45fr_1fr]">
        <section>
          <SectionTitle aside={<span>últimos 6 meses</span>}>Receitas e despesas</SectionTitle>
          {series.data && (
            <MoneyBarChart
              data={series.data.data.map((m) => ({ ...m, income: toNumber(m.income), expenses: toNumber(m.expenses) }))}
              xKey="month"
              xFormatter={formatMonthShort}
              tooltipLabel={formatMonthLong}
              series={[
                { key: 'income', label: 'Receitas', slot: 1 },
                { key: 'expenses', label: 'Despesas', slot: 2 },
              ]}
            />
          )}
        </section>

        <section>
          <SectionTitle>{formatMonthTitle(month)}</SectionTitle>
          <dl className="tabular divide-y divide-rule border-y border-rule">
            <Row label="Receitas" value={<Money value={d.monthSummary.income} />} />
            <Row label="Despesas" value={<Money value={d.monthSummary.expenses} />} />
            <Row label="Resultado" value={<Money value={d.monthSummary.net} sign />} strong />
            <Row label="Taxa de poupança" value={<span className="num">{formatPercent(d.monthSummary.savingsRate)}</span>} />
            <Row label="Investimentos" value={<Money value={d.balances.investments} />} />
            <Row label="Fatura dos cartões" value={<Money value={d.balances.creditCardDebt} />} />
          </dl>
        </section>

        <section>
          <SectionTitle aside={<Link to="/recorrentes" className="hover:text-ink hover:underline">ver todas</Link>}>Contas dos próximos 30 dias</SectionTitle>
          {d.upcomingBills.items.length === 0 ? (
            <Empty title="Nada agendado">Cadastre contas fixas (aluguel, assinaturas, salário) para ver o que vem por aí.</Empty>
          ) : (
            <ul className="tabular divide-y divide-rule border-y border-rule">
              {d.upcomingBills.items.slice(0, 8).map((u, i) => (
                <li key={`${u.date}-${u.description}-${i}`} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className={cx('num w-14 shrink-0', u.overdue ? 'font-medium text-neg' : 'text-ink-2')}>{formatDayMonth(u.date)}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {u.description}
                    {u.categoryId && <span className="text-ink-3"> · {label(u.categoryId)}</span>}
                  </span>
                  {u.overdue ? <Badge tone="neg">Atrasada</Badge> : u.kind === 'pending' ? <Badge tone="warn">A confirmar</Badge> : null}
                  <Money value={u.amount} sign className="w-28 text-right" />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <SectionTitle aside={<Link to="/cartoes" className="hover:text-ink hover:underline">faturas</Link>}>Cartões</SectionTitle>
          {d.creditCards.length === 0 ? (
            <Empty title="Nenhum cartão">Cadastre um cartão para acompanhar faturas e limite.</Empty>
          ) : (
            <ul className="space-y-4">
              {d.creditCards.map((c) => {
                const inv = c.nextDueInvoice ?? c.currentInvoice;
                const used = toNumber(c.creditLimit) - toNumber(c.availableLimit);
                return (
                  <li key={c.id} className="border-b border-rule pb-4 last:border-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-medium">{c.name}</span>
                      {inv && <Badge tone={INVOICE_STATUS[inv.status].tone}>{INVOICE_STATUS[inv.status].label}</Badge>}
                    </div>
                    {inv && (
                      <div className="mt-1 flex items-baseline justify-between text-sm text-ink-2">
                        <span>Fatura vence {formatDate(inv.dueDate)}</span>
                        <Money value={inv.status === 'paid' ? inv.total : inv.remaining} className="text-base font-semibold text-ink" />
                      </div>
                    )}
                    <div className="mt-2">
                      <ProgressBar value={(used / Math.max(toNumber(c.creditLimit), 1)) * 100} tone={toNumber(c.availableLimit) < 0 ? 'neg' : 'accent'} />
                      <div className="mt-1 text-[13px] text-ink-3">
                        Disponível {formatBRL(c.availableLimit)} de {formatBRL(c.creditLimit)}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section>
          <SectionTitle aside={cats.data && <span className="num">{formatBRL(cats.data.total)}</span>}>Gastos por categoria</SectionTitle>
          {cats.data && <CategoryBars rows={cats.data.categories} limit={7} />}
        </section>

        <section className="space-y-10">
          <div>
            <SectionTitle aside={<Link to="/metas" className="hover:text-ink hover:underline">todas</Link>}>Metas</SectionTitle>
            {d.goals.length === 0 ? (
              <Empty title="Nenhuma meta">Crie uma meta para acompanhar o progresso.</Empty>
            ) : (
              <ul className="space-y-4">
                {d.goals.map((g) => (
                  <li key={g.id}>
                    <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                      <span className="font-medium">{g.name}</span>
                      <span className="num text-ink-2">
                        {formatBRL(g.currentAmount)} <span className="text-ink-3">de {formatBRL(g.targetAmount)}</span>
                      </span>
                    </div>
                    <ProgressBar value={Number(g.progressPercent)} tone={g.isReached ? 'pos' : 'accent'} />
                    {g.forecastMonth && !g.isReached && (
                      <div className={cx('mt-1 text-[13px]', g.onTrack === false ? 'text-warn' : 'text-ink-3')}>
                        Previsão: {formatMonthLong(g.forecastMonth)}
                        {g.onTrack === false && ', depois do prazo'}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <SectionTitle aside={<span className="num">{formatBRL(d.upcomingInstallments.totalCommitted)} em 6 meses</span>}>Parcelas futuras</SectionTitle>
            <InstallmentStrip months={d.upcomingInstallments.months} />
          </div>
        </section>
      </div>
    </div>
  );
}

function lastDay(month: string) {
  const [y, m] = month.split('-').map(Number);
  return `-${new Date(Date.UTC(y!, m!, 0)).getUTCDate()}`;
}

function Row({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between py-2.5 text-sm">
      <dt className="text-ink-2">{label}</dt>
      <dd className={cx(strong && 'text-base font-semibold')}>{value}</dd>
    </div>
  );
}

/** Mini-barras HTML das parcelas por mês. */
function InstallmentStrip({ months }: { months: Dashboard['upcomingInstallments']['months'] }) {
  const max = Math.max(...months.map((m) => toNumber(m.total)), 1);
  return (
    <div className="grid grid-cols-6 items-end gap-2">
      {months.map((m) => (
        <div key={m.month} className="text-center" title={`${formatMonthLong(m.month)}: ${formatBRL(m.total)} em ${m.count} parcela(s)`}>
          <div className="num mb-1 text-[12px] text-ink-2">{toNumber(m.total) ? formatBRL(m.total).replace('R$ ', '').replace(/,\d\d$/, '') : '—'}</div>
          <div className="flex h-16 items-end">
            <div className="w-full rounded-t" style={{ height: `${Math.max((toNumber(m.total) / max) * 100, 2)}%`, background: 'var(--series-2)' }} />
          </div>
          <div className="mt-1 text-[12px] text-ink-3">{formatMonthShort(m.month)}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Hero: quanto posso gastar + régua do mês ────────────────────────────────

function SafeToSpendHero({
  s,
  isCurrent,
  balances,
  available,
}: {
  s: SafeToSpend;
  isCurrent: boolean;
  balances: Dashboard['balances'];
  available: Dashboard['available'];
}) {
  const income = Math.max(toNumber(s.income), 0.01);
  const remaining = toNumber(s.remaining);
  const over = remaining < 0;

  const segments = [
    { key: 'fixed', label: 'Contas fixas', value: s.fixedExpenses, color: 'var(--ruler-1)' },
    { key: 'inst', label: 'Parcelas', value: s.installments, color: 'var(--ruler-2)' },
    { key: 'sched', label: 'Outras agendadas', value: s.otherScheduled, color: 'var(--ruler-3)' },
    { key: 'reserve', label: 'Reserva', value: s.reserve, color: 'var(--ruler-4)' },
    { key: 'goals', label: 'Metas', value: s.goalContributions, color: 'var(--ruler-4)', hatch: true },
    { key: 'margin', label: 'Folga', value: s.safetyMargin, color: 'var(--ruler-4)', hatch: true },
    { key: 'spent', label: 'Já gasto (variável)', value: s.spentSoFar, color: 'var(--ruler-spent)' },
    { key: 'free', label: 'Livre', value: over ? '0' : s.remaining, color: 'var(--ruler-free)' },
  ].filter((x) => toNumber(x.value) > 0);
  const total = segments.reduce((a, x) => a + toNumber(x.value), 0);
  const scale = Math.max(total, income);

  const sourceLabel = { recurring: 'receitas fixas cadastradas', average_3m: 'média dos últimos 3 meses', fixed: 'renda informada' }[s.incomeSource];

  return (
    <section aria-labelledby="safe-title">
      <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p id="safe-title" className="text-ink-2">
            {isCurrent ? (over ? 'Você já passou do orçamento livre deste mês' : 'Você pode gastar por dia, até o fim do mês') : `Orçamento livre de ${formatMonthLong(s.month)}`}
          </p>
          <p className={cx('num mt-1 text-[56px] font-semibold leading-none tracking-[-0.03em] sm:text-[72px]', over && 'text-neg')}>
            {isCurrent ? (over ? formatBRL(s.remaining) : formatBRL(s.dailySafeAmount)) : formatBRL(s.discretionary)}
          </p>
          <p className="mt-3 max-w-xl text-sm text-ink-2">
            {isCurrent && !over && (
              <>
                Sobram <strong className="num font-semibold text-ink">{formatBRL(s.remaining)}</strong> do orçamento livre de {formatBRL(s.discretionary)}, para {s.daysLeft}{' '}
                {s.daysLeft === 1 ? 'dia' : 'dias'}.{' '}
              </>
            )}
            {isCurrent && over && <>O gasto variável ({formatBRL(s.spentSoFar)}) superou o orçamento livre ({formatBRL(s.discretionary)}). </>}
            Receita considerada: {formatBRL(s.income)} ({sourceLabel}).
          </p>
        </div>
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-6 lg:grid-cols-1 lg:gap-3 lg:text-right">
          {[
            { label: 'Saldo em conta', value: balances.current },
            { label: 'Previsto no fim do mês', value: available.amount },
            { label: 'Patrimônio líquido', value: balances.netWorth },
          ].map((item) => (
            <div key={item.label} className="flex items-baseline justify-between gap-4 sm:block">
              <dt className="text-[13px] text-ink-2">{item.label}</dt>
              <dd className={cx('num whitespace-nowrap text-[18px] font-semibold sm:text-[21px]', isNegative(item.value) && 'text-neg')}>{formatBRL(item.value)}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* A régua: 100% = receita do mês. Cada trecho é um compromisso da fórmula do gasto seguro. */}
      <div className="mt-8">
        <div className="relative">
          <div className="flex h-5 w-full gap-[2px] overflow-hidden rounded-[4px] bg-sunken" role="img" aria-label="Distribuição da receita do mês">
            {segments.map((x) => (
              <div
                key={x.key}
                title={`${x.label}: ${formatBRL(x.value)}`}
                style={{
                  width: `${(toNumber(x.value) / scale) * 100}%`,
                  background: x.hatch ? `repeating-linear-gradient(135deg, ${x.color} 0 3px, transparent 3px 6px)` : x.color,
                  boxShadow: x.hatch ? `inset 0 0 0 1px ${x.color}` : undefined,
                }}
              />
            ))}
          </div>
          {total > income && (
            <div className="absolute -top-1.5 h-8 w-0.5 bg-neg" style={{ left: `${(income / scale) * 100}%` }} title="Limite da receita do mês" />
          )}
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px]">
          {segments.map((x) => (
            <li key={x.key} className="flex items-center gap-1.5">
              <span
                className="inline-block size-2.5 rounded-[2px]"
                style={{ background: x.hatch ? `repeating-linear-gradient(135deg, ${x.color} 0 2px, transparent 2px 4px)` : x.color, boxShadow: x.hatch ? `inset 0 0 0 1px ${x.color}` : undefined }}
              />
              <span className="text-ink-2">{x.label}</span>
              <span className="num font-medium">{formatBRL(x.value)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[12px] text-ink-3">{s.disclaimer}</p>
      </div>
    </section>
  );
}
