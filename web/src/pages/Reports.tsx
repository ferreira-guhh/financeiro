import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { get, qs } from '../api/client';
import type { Metrics, MonthlyReport, WeeklyReport, YearlyReport } from '../api/types';
import { CategoryBars, ChartOrTable, MoneyBarChart, MoneyLineChart } from '../components/charts';
import { Button, ErrorNote, Loading, Money, PageHeader, SectionTitle, Segmented, Stat, Table, Td, Th, cx } from '../components/ui';
import {
  currentMonth,
  formatBRL,
  formatDate,
  formatDayMonth,
  formatMonthLong,
  formatMonthTitle,
  formatMonthShort,
  formatPercent,
  shiftDays,
  shiftMonth,
  todayISO,
  toNumber,
} from '../lib/format';

type Tab = 'monthly' | 'weekly' | 'yearly' | 'metrics';

export function ReportsPage() {
  const [tab, setTab] = useState<Tab>('monthly');
  return (
    <div>
      <PageHeader title="Relatórios" description="Fechamento da semana, do mês e do ano, com comparações e os indicadores de saúde financeira." />
      <div className="mb-8">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'monthly', label: 'Mensal' },
            { value: 'weekly', label: 'Semanal' },
            { value: 'yearly', label: 'Anual' },
            { value: 'metrics', label: 'Indicadores' },
          ]}
        />
      </div>
      {tab === 'monthly' && <Monthly />}
      {tab === 'weekly' && <Weekly />}
      {tab === 'yearly' && <Yearly />}
      {tab === 'metrics' && <MetricsView />}
    </div>
  );
}

function Stepper({ label, onPrev, onNext }: { label: ReactNode; onPrev: () => void; onNext: () => void }) {
  return (
    <div className="mb-6 flex items-center gap-1">
      <Button variant="ghost" size="sm" onClick={onPrev} aria-label="Anterior">
        ‹
      </Button>
      <span className="min-w-40 text-center font-medium">{label}</span>
      <Button variant="ghost" size="sm" onClick={onNext} aria-label="Próximo">
        ›
      </Button>
    </div>
  );
}

function Delta({ value, invert }: { value: string | null; invert?: boolean }) {
  if (value === null) return <span className="text-ink-3">sem base</span>;
  const n = Number(value);
  // Para despesas, subir é ruim (invert). Usa ícone + texto, nunca só cor.
  const bad = invert ? n > 0 : n < 0;
  return (
    <span className={cx('whitespace-nowrap', n === 0 ? 'text-ink-3' : bad ? 'text-neg' : 'text-pos')}>
      {n > 0 ? '▲' : n < 0 ? '▼' : '='} {formatPercent(String(Math.abs(n)))}
    </span>
  );
}

function Monthly() {
  const [month, setMonth] = useState(shiftMonth(currentMonth(), 0));
  const q = useQuery({ queryKey: ['report-monthly', month], queryFn: () => get<MonthlyReport>(`/reports/monthly${qs({ month })}`) });
  const r = q.data;
  return (
    <div>
      <Stepper label={formatMonthTitle(month)} onPrev={() => setMonth(shiftMonth(month, -1))} onNext={() => setMonth(shiftMonth(month, 1))} />
      {q.isLoading ? (
        <Loading />
      ) : !r ? (
        <ErrorNote error={q.error} />
      ) : (
        <div className="space-y-10">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Receita total" value={<Money value={r.income} />} hint={<>vs mês anterior: <Delta value={r.comparison.incomeChange} /></>} />
            <Stat label="Despesa total" value={<Money value={r.expenses} />} hint={<>vs mês anterior: <Delta value={r.comparison.expensesChange} invert /></>} />
            <Stat label="Saldo do mês" value={<Money value={r.balance} sign />} />
            <Stat label="Taxa de poupança" value={formatPercent(r.savingsRate)} hint={`mês anterior: ${formatPercent(r.comparison.previousSavingsRate)}`} />
          </div>

          {r.insights.length > 0 && (
            <section className="rounded-lg border border-rule bg-surface p-5">
              <SectionTitle>Pontos de atenção</SectionTitle>
              <ul className="space-y-1.5 text-sm">
                {r.insights.map((i) => (
                  <li key={i.category}>
                    {i.message} <span className="text-ink-3">({formatBRL(i.current)} contra média de {formatBRL(i.average3m)})</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="grid gap-10 lg:grid-cols-2">
            <section>
              <SectionTitle>Gastos por categoria</SectionTitle>
              <Table>
                <thead>
                  <tr>
                    <Th>Categoria</Th>
                    <Th right>Valor</Th>
                    <Th right>%</Th>
                    <Th right>vs anterior</Th>
                  </tr>
                </thead>
                <tbody>
                  {r.byCategory.map((c) => (
                    <tr key={c.name}>
                      <Td>
                        {c.name}
                        {c.isEssential && <span className="ml-1.5 text-[12px] text-ink-3">essencial</span>}
                      </Td>
                      <Td right>
                        <Money value={c.total} tone="plain" />
                      </Td>
                      <Td right className="num text-ink-2">
                        {formatPercent(c.share, 0)}
                      </Td>
                      <Td right>
                        <Delta value={c.changeVsPrevious} invert />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </section>
            <section className="space-y-8">
              <div>
                <SectionTitle>Composição</SectionTitle>
                <dl className="tabular divide-y divide-rule border-y border-rule text-sm">
                  {[
                    ['Receita fixa', r.fixedIncome],
                    ['Receita variável', r.variableIncome],
                    ['Despesas essenciais', r.essentialExpenses],
                    ['Estilo de vida', r.lifestyleExpenses],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between py-2.5">
                      <dt className="text-ink-2">{k}</dt>
                      <dd>
                        <Money value={v} tone="plain" />
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div>
                <SectionTitle>Maiores despesas</SectionTitle>
                <ExpenseList items={r.biggestExpenses} />
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

function ExpenseList({ items }: { items: MonthlyReport['biggestExpenses'] }) {
  if (!items.length) return <p className="text-sm text-ink-3">Nenhuma despesa.</p>;
  return (
    <ul className="tabular divide-y divide-rule border-y border-rule">
      {items.map((e) => (
        <li key={e.id} className="flex items-center gap-3 py-2.5 text-sm">
          <span className="num w-14 text-ink-2">{formatDayMonth(e.date)}</span>
          <span className="min-w-0 flex-1 truncate">
            {e.description}
            {e.categoryName && <span className="text-ink-3"> · {e.categoryName}</span>}
          </span>
          <Money value={e.amount} tone="plain" />
        </li>
      ))}
    </ul>
  );
}

function Weekly() {
  const [date, setDate] = useState(todayISO());
  const q = useQuery({ queryKey: ['report-weekly', date], queryFn: () => get<WeeklyReport>(`/reports/weekly${qs({ date })}`) });
  const r = q.data;
  return (
    <div>
      <Stepper
        label={r ? `${formatDate(r.weekStart)} – ${formatDate(r.weekEnd)}` : '…'}
        onPrev={() => setDate(shiftDays(date, -7))}
        onNext={() => setDate(shiftDays(date, 7))}
      />
      {q.isLoading ? (
        <Loading />
      ) : !r ? (
        <ErrorNote error={q.error} />
      ) : (
        <div className="space-y-10">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Total recebido" value={<Money value={r.income} />} />
            <Stat label="Total gasto" value={<Money value={r.expenses} />} hint={<>vs semana anterior: <Delta value={r.comparison.changeVsPreviousWeek} invert /></>} />
            <Stat label="Média das 4 semanas anteriores" value={<Money value={r.comparison.average4WeeksExpenses} />} hint={<>esta semana: <Delta value={r.comparison.changeVsAverage} invert /></>} />
            <Stat label="Saldo da semana" value={<Money value={r.net} sign />} />
          </div>
          <div className="grid gap-10 lg:grid-cols-2">
            <section>
              <SectionTitle>Principais categorias</SectionTitle>
              <CategoryBars rows={r.topCategories} />
            </section>
            <section>
              <SectionTitle>Maiores despesas</SectionTitle>
              <ExpenseList items={r.biggestExpenses} />
            </section>
          </div>
          <section>
            <SectionTitle>Comparação com semanas anteriores</SectionTitle>
            <MoneyBarChart
              data={[...r.previousWeeks].reverse().concat({ weekStart: r.weekStart, income: r.income, expenses: r.expenses }).map((w) => ({ week: w.weekStart, income: toNumber(w.income), expenses: toNumber(w.expenses) }))}
              xKey="week"
              xFormatter={(d) => `sem. ${formatDayMonth(d)}`}
              series={[
                { key: 'income', label: 'Recebido', slot: 1 },
                { key: 'expenses', label: 'Gasto', slot: 2 },
              ]}
              height={220}
            />
          </section>
        </div>
      )}
    </div>
  );
}

function Yearly() {
  const [year, setYear] = useState(new Date().getFullYear());
  const q = useQuery({ queryKey: ['report-yearly', year], queryFn: () => get<YearlyReport>(`/reports/yearly${qs({ year })}`) });
  const r = q.data;
  return (
    <div>
      <Stepper label={String(year)} onPrev={() => setYear(year - 1)} onNext={() => setYear(year + 1)} />
      {q.isLoading ? (
        <Loading />
      ) : !r ? (
        <ErrorNote error={q.error} />
      ) : (
        <div className="space-y-10">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Total recebido" value={<Money value={r.totalIncome} />} hint={`média ${formatBRL(r.monthlyAverageIncome)}/mês`} />
            <Stat label="Total gasto" value={<Money value={r.totalExpenses} />} hint={`média ${formatBRL(r.monthlyAverageExpenses)}/mês`} />
            <Stat label="Total investido" value={<Money value={r.totalInvested} />} hint="aportes líquidos em contas de investimento" />
            <Stat label="Patrimônio" value={<Money value={r.endNetWorth} />} hint={`início do ano: ${formatBRL(r.startNetWorth)}`} />
          </div>
          <section>
            <SectionTitle aside={r.bestMonth && `melhor mês: ${formatMonthLong(r.bestMonth)}`}>Evolução mensal</SectionTitle>
            <ChartOrTable
              chart={
                <MoneyBarChart
                  data={r.months.map((m) => ({ month: m.month, income: toNumber(m.income), expenses: toNumber(m.expenses) }))}
                  xKey="month"
                  xFormatter={formatMonthShort}
                  tooltipLabel={formatMonthLong}
                  series={[
                    { key: 'income', label: 'Receitas', slot: 1 },
                    { key: 'expenses', label: 'Despesas', slot: 2 },
                  ]}
                />
              }
              table={<MonthTable months={r.months} />}
            />
          </section>
          <div className="grid gap-10 lg:grid-cols-2">
            <section>
              <SectionTitle>Evolução do patrimônio</SectionTitle>
              <MoneyLineChart
                data={r.months.filter((m) => m.endNetWorth !== null).map((m) => ({ month: m.month, netWorth: toNumber(m.endNetWorth), balance: toNumber(m.endBalance) }))}
                xKey="month"
                xFormatter={formatMonthShort}
                tooltipLabel={formatMonthLong}
                series={[
                  { key: 'netWorth', label: 'Patrimônio líquido', slot: 1 },
                  { key: 'balance', label: 'Saldo em conta', slot: 3 },
                ]}
                height={220}
              />
            </section>
            <section>
              <SectionTitle>Categorias que mais consumiram</SectionTitle>
              <CategoryBars rows={r.topCategories} />
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

function MonthTable({ months }: { months: YearlyReport['months'] }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Mês</Th>
          <Th right>Receitas</Th>
          <Th right>Despesas</Th>
          <Th right>Saldo</Th>
          <Th right>Poupança</Th>
        </tr>
      </thead>
      <tbody>
        {months.map((m) => (
          <tr key={m.month}>
            <Td>{formatMonthTitle(m.month)}</Td>
            <Td right>
              <Money value={m.income} tone="plain" />
            </Td>
            <Td right>
              <Money value={m.expenses} tone="plain" />
            </Td>
            <Td right>
              <Money value={m.net} sign />
            </Td>
            <Td right className="num">
              {formatPercent(m.savingsRate)}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function MetricsView() {
  const q = useQuery({ queryKey: ['metrics'], queryFn: () => get<Metrics>('/metrics') });
  const m = q.data;
  if (q.isLoading) return <Loading />;
  if (!m) return <ErrorNote error={q.error} />;
  const items: { title: string; value: ReactNode; text: ReactNode }[] = [
    { title: 'Margem de poupança', value: formatPercent(m.savingsMargin.rate), text: <>Do que entrou no mês, quanto sobrou. Receitas {formatBRL(m.savingsMargin.income)}, despesas {formatBRL(m.savingsMargin.expenses)}.</> },
    { title: 'Burn rate', value: <Money value={m.burnRate.monthly} />, text: <>Despesa média mensal dos últimos 3 meses. {m.burnRate.runwayMonths && <>Com o saldo atual, sem receitas, dá para {m.burnRate.runwayMonths.replace('.', ',')} meses.</>}</> },
    { title: 'Ponto de equilíbrio', value: <Money value={m.breakEven.requiredIncome} />, text: <>Receita mínima para não fechar no negativo: fixos e parcelas ({formatBRL(m.breakEven.fixedCosts)}) mais o variável médio ({formatBRL(m.breakEven.averageVariable)}). Sua receita cobre {formatPercent(m.breakEven.coverage, 0)}.</> },
    { title: 'Comprometimento da renda', value: formatPercent(m.incomeCommitment.percent), text: <>Já comprometido com contas fixas ({formatBRL(m.incomeCommitment.fixedRecurring)}) e parcelas ({formatBRL(m.incomeCommitment.installments)}).</> },
    { title: 'Despesas acumuladas', value: <Money value={m.accumulatedExpenses.yearToDate} />, text: <>No ano até hoje. Neste mês: {formatBRL(m.accumulatedExpenses.monthToDate)}.</> },
    { title: 'Média de gastos', value: <Money value={m.averageSpending.dailyThisMonth} />, text: <>Por dia neste mês. Média mensal dos últimos 6 meses: {formatBRL(m.averageSpending.monthlyLast6)}.</> },
  ];
  return (
    <div className="space-y-10">
      <div className="grid gap-x-10 gap-y-8 md:grid-cols-2 lg:grid-cols-3">
        {items.map((i) => (
          <div key={i.title} className="border-t border-rule pt-4">
            <div className="text-sm text-ink-2">{i.title}</div>
            <div className="num mt-1 text-[28px] font-semibold leading-tight">{i.value}</div>
            <p className="mt-1.5 text-sm text-ink-2">{i.text}</p>
          </div>
        ))}
      </div>
      <section>
        <SectionTitle>Projeção de saldo em conta</SectionTitle>
        <Table>
          <thead>
            <tr>
              <Th />
              <Th right>Hoje</Th>
              <Th right>Fim do mês</Th>
              <Th right>Em 3 meses</Th>
              <Th right>Em 6 meses</Th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <Td>Só compromissos conhecidos</Td>
              <Td right>
                <Money value={m.balanceProjection.current} />
              </Td>
              <Td right>
                <Money value={m.balanceProjection.endOfMonth} />
              </Td>
              <Td right>
                <Money value={m.balanceProjection.in3Months} />
              </Td>
              <Td right>
                <Money value={m.balanceProjection.in6Months} />
              </Td>
            </tr>
            <tr>
              <Td>Incluindo gasto variável médio</Td>
              <Td right>
                <Money value={m.balanceProjection.current} />
              </Td>
              <Td right>
                <Money value={m.balanceProjection.withVariableSpending.endOfMonth} />
              </Td>
              <Td right>
                <Money value={m.balanceProjection.withVariableSpending.in3Months} />
              </Td>
              <Td right>
                <Money value={m.balanceProjection.withVariableSpending.in6Months} />
              </Td>
            </tr>
          </tbody>
        </Table>
      </section>
    </div>
  );
}
