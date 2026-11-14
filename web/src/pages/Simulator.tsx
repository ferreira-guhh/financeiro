import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { get, post } from '../api/client';
import { useGoals } from '../api/hooks';
import { MoneyLineChart } from '../components/charts';
import { Button, ErrorNote, Field, Input, Loading, Money, MoneyInput, PageHeader, SectionTitle, Segmented, Select, Stat } from '../components/ui';
import { currentMonth, formatBRL, formatMonthLong, formatMonthTitle, formatMonthShort, parseMoneyInput, shiftMonth, toNumber } from '../lib/format';

/** Atrasa a atualização para recalcular só quando o usuário para de digitar. */
function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const money = (s: string, fallback = '0.00') => parseMoneyInput(s)?.replace('-', '') ?? fallback;
const pct = (s: string) => (s.trim() ? s.replace(',', '.') : '0');

export function SimulatorPage() {
  const [tool, setTool] = useState<'savings' | 'goal' | 'scenario'>('savings');
  return (
    <div>
      <PageHeader title="Simulador" description="Mude os números e veja o resultado na hora. Nada aqui altera seus lançamentos." />
      <div className="mb-8">
        <Segmented
          value={tool}
          onChange={setTool}
          options={[
            { value: 'savings', label: 'Quanto vou juntar' },
            { value: 'goal', label: 'Quando chego na meta' },
            { value: 'scenario', label: 'E se meu orçamento mudar' },
          ]}
        />
      </div>
      {tool === 'savings' && <SavingsSim />}
      {tool === 'goal' && <GoalSim />}
      {tool === 'scenario' && <ScenarioSim />}
    </div>
  );
}

// ─── Juros compostos + aportes + inflação ────────────────────────────────────

interface SavingsResult {
  months: { month: string; balance: string; totalContributed: string; realBalance: string }[];
  summary: { finalBalance: string; totalContributed: string; totalInterest: string; finalRealBalance: string; interestShare: string };
}

function SavingsSim() {
  const [initial, setInitial] = useState('0');
  const [monthly, setMonthly] = useState('300');
  const [years, setYears] = useState('2');
  const [rate, setRate] = useState('10');
  const [inflation, setInflation] = useState('4,5');
  const body = useDebounced({ initialAmount: money(initial), monthlyContribution: money(monthly), months: Math.max(1, Math.min(600, Math.round(Number(years.replace(',', '.')) * 12) || 1)), annualRatePercent: pct(rate), annualInflationPercent: pct(inflation) });
  const q = useQuery({ queryKey: ['sim-savings', body], queryFn: () => post<SavingsResult>('/simulations/savings', body), placeholderData: (p) => p });
  const r = q.data;

  return (
    <div className="grid gap-10 lg:grid-cols-[300px_1fr]">
      <div className="space-y-4">
        <Field label="Já tenho guardado">{(id) => <MoneyInput id={id} value={initial} onChange={(e) => setInitial(e.target.value)} />}</Field>
        <Field label="Vou guardar por mês">{(id) => <MoneyInput id={id} value={monthly} onChange={(e) => setMonthly(e.target.value)} />}</Field>
        <Field label="Durante (anos)">{(id) => <Input id={id} inputMode="decimal" value={years} onChange={(e) => setYears(e.target.value)} />}</Field>
        <Field label="Rendimento (% ao ano)" hint="Ex.: 100% do CDI ≈ taxa Selic atual">
          {(id) => <Input id={id} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />}
        </Field>
        <Field label="Inflação (% ao ano)">{(id) => <Input id={id} inputMode="decimal" value={inflation} onChange={(e) => setInflation(e.target.value)} />}</Field>
      </div>
      <div>
        <ErrorNote error={q.error} />
        {!r ? (
          <Loading />
        ) : (
          <>
            <p className="text-ink-2">Ao final você terá</p>
            <p className="num text-[48px] font-semibold leading-tight tracking-[-0.02em]">{formatBRL(r.summary.finalBalance)}</p>
            <p className="mt-1 max-w-xl text-sm text-ink-2">
              Você guarda {formatBRL(r.summary.totalContributed)} e os juros somam {formatBRL(r.summary.totalInterest)}. Descontada a inflação, isso compra o equivalente a{' '}
              <strong className="num font-semibold text-ink">{formatBRL(r.summary.finalRealBalance)}</strong> hoje.
            </p>
            <div className="mt-8">
              <MoneyLineChart
                data={r.months.map((m) => ({ month: m.month, balance: toNumber(m.balance), contributed: toNumber(m.totalContributed), real: toNumber(m.realBalance) }))}
                xKey="month"
                xFormatter={formatMonthShort}
                tooltipLabel={formatMonthLong}
                series={[
                  { key: 'balance', label: 'Saldo com juros', slot: 1 },
                  { key: 'real', label: 'Em dinheiro de hoje', slot: 2 },
                  { key: 'contributed', label: 'Só o que você guardou', slot: 'muted', dashed: true },
                ]}
                height={300}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Meta: prazo e impacto de um valor extra ─────────────────────────────────

interface GoalSimResult {
  goalName: string | null;
  remaining: string;
  baseline: { monthlyContribution: string; months: number | null; reachedMonth: string | null; series: { month: string; balance: string }[] };
  withExtra: { monthlyContribution: string; months: number | null; reachedMonth: string | null; series: { month: string; balance: string }[] } | null;
  monthsSaved: number | null;
  requiredForTargetDate: string | null;
}

function GoalSim() {
  const goals = useGoals();
  const [goalId, setGoalId] = useState('');
  const [target, setTarget] = useState('10000');
  const [current, setCurrent] = useState('0');
  const [monthly, setMonthly] = useState('500');
  const [extra, setExtra] = useState('150');
  const [rate, setRate] = useState('0');
  const goal = goals.data?.find((g) => g.id === goalId);

  useEffect(() => {
    if (goal) {
      setMonthly((goal.monthlyContribution ?? goal.requiredMonthlyContribution ?? '0').replace('.', ','));
      setRate((goal.expectedAnnualRate ?? '0').replace('.', ','));
    }
  }, [goal]);

  const body = useDebounced(
    goalId
      ? { goalId, monthlyContribution: money(monthly), extraMonthly: money(extra), annualRatePercent: pct(rate) }
      : { targetAmount: money(target, '1.00'), currentAmount: money(current), monthlyContribution: money(monthly), extraMonthly: money(extra), annualRatePercent: pct(rate) },
  );
  const q = useQuery({ queryKey: ['sim-goal', body], queryFn: () => post<GoalSimResult>('/simulations/goal', body), placeholderData: (p) => p });
  const r = q.data;

  const merged = (() => {
    if (!r) return [];
    const map = new Map<string, { month: string; baseline?: number; extra?: number }>();
    for (const s of r.baseline.series) map.set(s.month, { month: s.month, baseline: toNumber(s.balance) });
    for (const s of r.withExtra?.series ?? []) map.set(s.month, { ...(map.get(s.month) ?? { month: s.month }), extra: toNumber(s.balance) });
    return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
  })();

  return (
    <div className="grid gap-10 lg:grid-cols-[300px_1fr]">
      <div className="space-y-4">
        <Field label="Meta">
          {(id) => (
            <Select id={id} value={goalId} onChange={(e) => setGoalId(e.target.value)}>
              <option value="">Simular valores livres</option>
              {goals.data?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {!goalId && (
          <>
            <Field label="Valor da meta">{(id) => <MoneyInput id={id} value={target} onChange={(e) => setTarget(e.target.value)} />}</Field>
            <Field label="Já tenho">{(id) => <MoneyInput id={id} value={current} onChange={(e) => setCurrent(e.target.value)} />}</Field>
          </>
        )}
        <Field label="Guardo por mês">{(id) => <MoneyInput id={id} value={monthly} onChange={(e) => setMonthly(e.target.value)} />}</Field>
        <Field label="E se eu guardar a mais…" hint="Ex.: cortando R$ 150 de delivery">
          {(id) => <MoneyInput id={id} value={extra} onChange={(e) => setExtra(e.target.value)} />}
        </Field>
        <Field label="Rendimento (% ao ano)">{(id) => <Input id={id} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />}</Field>
      </div>
      <div>
        <ErrorNote error={q.error} />
        {!r ? (
          <Loading />
        ) : (
          <>
            <div className="grid gap-6 sm:grid-cols-3">
              <Stat label={`Guardando ${formatBRL(r.baseline.monthlyContribution)}/mês`} value={r.baseline.reachedMonth ? formatMonthTitle(r.baseline.reachedMonth) : 'Não alcança'} hint={r.baseline.months !== null ? `${r.baseline.months} meses` : undefined} />
              {r.withExtra && (
                <Stat label={`Guardando ${formatBRL(r.withExtra.monthlyContribution)}/mês`} value={r.withExtra.reachedMonth ? formatMonthTitle(r.withExtra.reachedMonth) : 'Não alcança'} hint={r.withExtra.months !== null ? `${r.withExtra.months} meses` : undefined} />
              )}
              <Stat
                label="Diferença"
                value={r.monthsSaved !== null ? (r.monthsSaved < 0 ? `${-r.monthsSaved} ${r.monthsSaved === -1 ? 'mês' : 'meses'} antes` : r.monthsSaved === 0 ? 'Mesmo prazo' : `${r.monthsSaved} meses depois`) : '—'}
                hint={r.requiredForTargetDate ? `Para cumprir o prazo: ${formatBRL(r.requiredForTargetDate)}/mês` : undefined}
              />
            </div>
            <div className="mt-8">
              <MoneyLineChart
                data={merged}
                xKey="month"
                xFormatter={formatMonthShort}
                tooltipLabel={formatMonthLong}
                series={[
                  { key: 'baseline', label: 'Ritmo atual', slot: 1 },
                  ...(r.withExtra ? [{ key: 'extra', label: 'Com o valor extra', slot: 2 as const }] : []),
                ]}
                height={280}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Cenário do orçamento ────────────────────────────────────────────────────

interface Baseline {
  startMonth: string;
  startingBalance: string;
  monthlyIncome: string;
  monthlyFixedExpenses: string;
  monthlyVariableExpenses: string;
}

interface ScenarioResult {
  baseline: Baseline;
  months: { month: string; baselineBalance: string; scenarioBalance: string; baselineNet: string; scenarioNet: string }[];
  summary: { baselineFinalBalance: string; scenarioFinalBalance: string; difference: string; averageMonthlyDifference: string; scenarioFirstNegativeMonth: string | null };
  goalImpact: { goal: string; baseline: { reachedMonth: string | null }; scenario: { reachedMonth: string | null }; monthsDifference: number | null } | null;
}

function ScenarioSim() {
  const base = useQuery({ queryKey: ['sim-baseline'], queryFn: () => get<Baseline>('/simulations/baseline?months=24') });
  const goals = useGoals();
  const [months, setMonths] = useState('24');
  const [cut, setCut] = useState('150');
  const [raise, setRaise] = useState('0');
  const [raiseStart, setRaiseStart] = useState(shiftMonth(currentMonth(), 3));
  const [purchase, setPurchase] = useState('0');
  const [purchaseN, setPurchaseN] = useState('12');
  const [newRecurring, setNewRecurring] = useState('0');
  const [goalId, setGoalId] = useState('');

  const body = useDebounced({
    months: Math.max(1, Math.min(120, Number(months) || 24)),
    goalId: goalId || undefined,
    adjustments: {
      ...(toNumber(money(cut)) > 0 && { expenseCuts: [{ label: 'Corte', monthlyAmount: money(cut) }] }),
      ...(toNumber(money(raise)) > 0 && { incomeChange: { amount: money(raise), startMonth: raiseStart } }),
      ...(toNumber(money(purchase)) > 0 && { newInstallmentPurchases: [{ label: 'Compra', totalAmount: money(purchase), installments: Math.max(1, Number(purchaseN) || 1) }] }),
      ...(toNumber(money(newRecurring)) > 0 && { newRecurringExpenses: [{ label: 'Nova despesa', monthlyAmount: money(newRecurring) }] }),
    },
  });
  const q = useQuery({ queryKey: ['sim-scenario', body], queryFn: () => post<ScenarioResult>('/simulations/scenario', body), placeholderData: (p) => p });
  const r = q.data;

  return (
    <div className="grid gap-10 lg:grid-cols-[300px_1fr]">
      <div className="space-y-4">
        {base.data && (
          <div className="rounded-md bg-sunken p-3 text-[13px] text-ink-2">
            Ponto de partida, calculado dos seus dados: receita {formatBRL(base.data.monthlyIncome)}, fixas {formatBRL(base.data.monthlyFixedExpenses)}, variável médio{' '}
            {formatBRL(base.data.monthlyVariableExpenses)}, saldo {formatBRL(base.data.startingBalance)}. Parcelas já contratadas entram mês a mês.
          </div>
        )}
        <Field label="Cortar despesas (por mês)">{(id) => <MoneyInput id={id} value={cut} onChange={(e) => setCut(e.target.value)} />}</Field>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Field label="Aumento de renda (por mês)">{(id) => <MoneyInput id={id} value={raise} onChange={(e) => setRaise(e.target.value)} />}</Field>
          <Field label="A partir de">{(id) => <Input id={id} type="month" value={raiseStart} onChange={(e) => setRaiseStart(e.target.value)} className="w-36" />}</Field>
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Field label="Nova compra parcelada (total)">{(id) => <MoneyInput id={id} value={purchase} onChange={(e) => setPurchase(e.target.value)} />}</Field>
          <Field label="Parcelas">{(id) => <Input id={id} type="number" min={1} max={120} value={purchaseN} onChange={(e) => setPurchaseN(e.target.value)} className="w-20" />}</Field>
        </div>
        <Field label="Nova despesa recorrente (por mês)">{(id) => <MoneyInput id={id} value={newRecurring} onChange={(e) => setNewRecurring(e.target.value)} />}</Field>
        <Field label="Medir impacto na meta">
          {(id) => (
            <Select id={id} value={goalId} onChange={(e) => setGoalId(e.target.value)}>
              <option value="">Nenhuma</option>
              {goals.data?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Horizonte (meses)">{(id) => <Input id={id} type="number" min={1} max={120} value={months} onChange={(e) => setMonths(e.target.value)} />}</Field>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setCut('0');
            setRaise('0');
            setPurchase('0');
            setNewRecurring('0');
          }}
        >
          Zerar mudanças
        </Button>
      </div>
      <div>
        <ErrorNote error={q.error} />
        {!r ? (
          <Loading />
        ) : (
          <>
            <div className="grid gap-6 sm:grid-cols-3">
              <Stat label="Saldo acumulado sem mudanças" value={<Money value={r.summary.baselineFinalBalance} />} hint={`em ${formatMonthLong(r.months.at(-1)?.month ?? r.baseline.startMonth)}`} />
              <Stat label="Com as mudanças" value={<Money value={r.summary.scenarioFinalBalance} />} hint={<>diferença <Money value={r.summary.difference} sign /></>} />
              <Stat
                label={r.goalImpact ? `Meta “${r.goalImpact.goal}”` : 'Diferença média por mês'}
                value={
                  r.goalImpact ? (
                    r.goalImpact.monthsDifference === null ? (
                      'Não alcança'
                    ) : r.goalImpact.monthsDifference < 0 ? (
                      `${-r.goalImpact.monthsDifference} meses antes`
                    ) : r.goalImpact.monthsDifference === 0 ? (
                      'Mesmo prazo'
                    ) : (
                      <span className="text-neg">{r.goalImpact.monthsDifference} meses depois</span>
                    )
                  ) : (
                    <Money value={r.summary.averageMonthlyDifference} sign />
                  )
                }
                hint={r.goalImpact?.scenario.reachedMonth ? `conclusão em ${formatMonthLong(r.goalImpact.scenario.reachedMonth)}` : undefined}
              />
            </div>
            {r.summary.scenarioFirstNegativeMonth && (
              <p className="mt-4 rounded-md bg-neg-soft px-3 py-2 text-sm text-neg">Nesse cenário o saldo acumulado fica negativo em {formatMonthLong(r.summary.scenarioFirstNegativeMonth)}.</p>
            )}
            <div className="mt-8">
              <SectionTitle>Saldo acumulado</SectionTitle>
              <MoneyLineChart
                data={r.months.map((m) => ({ month: m.month, baseline: toNumber(m.baselineBalance), scenario: toNumber(m.scenarioBalance) }))}
                xKey="month"
                xFormatter={formatMonthShort}
                tooltipLabel={formatMonthLong}
                series={[
                  { key: 'baseline', label: 'Sem mudanças', slot: 1 },
                  { key: 'scenario', label: 'Com as mudanças', slot: 2 },
                ]}
                zeroLine
                height={300}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
