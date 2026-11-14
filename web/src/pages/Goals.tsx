import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { del, get, patch, post, qs } from '../api/client';
import { useAction, useGoals } from '../api/hooks';
import type { Goal, GoalProjection } from '../api/types';
import { MoneyLineChart } from '../components/charts';
import { AccountSelect } from '../components/selects';
import { Badge, Button, Empty, ErrorNote, Field, FormActions, Input, Loading, Modal, Money, MoneyInput, PageHeader, ProgressBar, Select, Table, Td, Th, cx } from '../components/ui';
import { formatBRL, formatDate, formatMonthLong, formatMonthTitle, formatMonthShort, moneyToInput, parseMoneyInput, todayISO, toNumber } from '../lib/format';

const KINDS: Record<string, string> = {
  emergency_reserve: 'Reserva de emergência',
  purchase: 'Compra',
  travel: 'Viagem',
  vehicle: 'Veículo',
  education: 'Educação',
  investment: 'Investimento',
  other: 'Outra',
};

export function GoalsPage() {
  const goals = useGoals();
  const [editing, setEditing] = useState<Goal | 'new' | null>(null);
  const [contributing, setContributing] = useState<Goal | null>(null);
  const [projecting, setProjecting] = useState<Goal | null>(null);

  return (
    <div>
      <PageHeader
        title="Metas"
        description="Quanto falta, quanto guardar por mês e quando cada objetivo será alcançado no ritmo atual."
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            Nova meta
          </Button>
        }
      />
      {goals.isLoading ? (
        <Loading />
      ) : goals.error ? (
        <ErrorNote error={goals.error} />
      ) : !goals.data?.length ? (
        <Empty title="Nenhuma meta" action={<Button variant="primary" onClick={() => setEditing('new')}>Nova meta</Button>}>
          Reserva de emergência, viagem, carro, curso — defina o valor e o prazo.
        </Empty>
      ) : (
        <ul className="tabular divide-y divide-rule border-y border-rule">
          {goals.data.map((g) => (
            <li key={g.id} className="grid gap-4 py-5 md:grid-cols-[1.3fr_1fr_auto] md:items-center">
              <div>
                <div className="flex flex-wrap items-baseline gap-2">
                  <button type="button" onClick={() => setEditing(g)} className="text-[17px] font-semibold hover:underline">
                    {g.name}
                  </button>
                  <span className="text-[13px] text-ink-3">{KINDS[g.kind]}</span>
                  {g.isReached && <Badge tone="pos">Alcançada</Badge>}
                  {g.onTrack === false && <Badge tone="warn">Atrasada no ritmo atual</Badge>}
                </div>
                <div className="mt-2 flex items-baseline justify-between gap-3 text-sm">
                  <span className="num">
                    <strong className="font-semibold">{formatBRL(g.currentAmount)}</strong> <span className="text-ink-3">de {formatBRL(g.targetAmount)}</span>
                  </span>
                  <span className="num text-ink-2">{Number(g.progressPercent).toFixed(0)}%</span>
                </div>
                <div className="mt-1.5">
                  <ProgressBar value={Number(g.progressPercent)} tone={g.isReached ? 'pos' : 'accent'} />
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-[13px] text-ink-2">Falta</dt>
                  <dd className="num font-medium">{formatBRL(g.remainingAmount)}</dd>
                </div>
                <div>
                  <dt className="text-[13px] text-ink-2">{g.targetDate ? `Guardar/mês até ${formatDate(g.targetDate)}` : 'Aporte mensal'}</dt>
                  <dd className="num font-medium">{g.targetDate ? formatBRL(g.requiredMonthlyContribution) : formatBRL(g.monthlyContribution)}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-[13px] text-ink-2">Previsão de conclusão</dt>
                  <dd className={cx('font-medium', g.onTrack === false && 'text-warn')}>
                    {g.isReached ? 'Já alcançada' : g.forecastMonth ? `${formatMonthLong(g.forecastMonth)} (guardando ${formatBRL(g.monthlyContribution)}/mês)` : 'Defina um aporte mensal'}
                  </dd>
                </div>
              </dl>
              <div className="flex gap-2 md:flex-col">
                <Button size="sm" onClick={() => setProjecting(g)}>
                  Projeção
                </Button>
                {!g.linkedAccountId && g.status === 'active' && (
                  <Button size="sm" onClick={() => setContributing(g)}>
                    Aportar
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Nova meta' : 'Editar meta'}>
        {editing && <GoalForm goal={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      </Modal>
      <Modal open={Boolean(contributing)} onClose={() => setContributing(null)} title={`Aporte em ${contributing?.name ?? ''}`}>
        {contributing && <ContributionForm goal={contributing} onDone={() => setContributing(null)} />}
      </Modal>
      <Modal open={Boolean(projecting)} onClose={() => setProjecting(null)} title={`Projeção — ${projecting?.name ?? ''}`} wide>
        {projecting && <ProjectionView goal={projecting} />}
      </Modal>
    </div>
  );
}

function GoalForm({ goal, onDone }: { goal: Goal | null; onDone: () => void }) {
  const [name, setName] = useState(goal?.name ?? '');
  const [kind, setKind] = useState(goal?.kind ?? 'other');
  const [target, setTarget] = useState(moneyToInput(goal?.targetAmount));
  const [initial, setInitial] = useState('');
  const [monthly, setMonthly] = useState(moneyToInput(goal?.monthlyContribution));
  const [rate, setRate] = useState(goal?.expectedAnnualRate?.replace('.', ',') ?? '');
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? '');
  const [linkedAccountId, setLinked] = useState(goal?.linkedAccountId ?? '');
  const save = useAction((body: object) => (goal ? patch(`/goals/${goal.id}`, body) : post('/goals', body)), onDone);
  const remove = useAction(() => del(`/goals/${goal!.id}`), onDone);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const base = {
      name,
      kind,
      targetAmount: parseMoneyInput(target),
      monthlyContribution: monthly ? parseMoneyInput(monthly) : goal ? null : undefined,
      expectedAnnualRate: rate ? rate.replace(',', '.') : goal ? null : undefined,
      targetDate: targetDate || (goal ? null : undefined),
      linkedAccountId: linkedAccountId || (goal ? null : undefined),
    };
    save.mutate(goal ? base : { ...base, initialAmount: initial ? parseMoneyInput(initial) : undefined });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} required />}</Field>
        <Field label="Tipo">
          {(id) => (
            <Select id={id} value={kind} onChange={(e) => setKind(e.target.value)}>
              {Object.entries(KINDS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Valor objetivo">{(id) => <MoneyInput id={id} value={target} onChange={(e) => setTarget(e.target.value)} required />}</Field>
        <Field label="Prazo" hint="Opcional">
          {(id) => <Input id={id} type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />}
        </Field>
        <Field label="Aporte mensal desejado">{(id) => <MoneyInput id={id} value={monthly} onChange={(e) => setMonthly(e.target.value)} />}</Field>
        <Field label="Rendimento esperado (% a.a.)" hint="Opcional, só para projeção">
          {(id) => <Input id={id} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="ex.: 10,5" />}
        </Field>
      </div>
      <Field label="Vincular a uma conta" hint="Se vinculada, o valor atual da meta é o saldo dessa conta.">
        {(id) => <AccountSelect id={id} value={linkedAccountId} onChange={setLinked} types={['savings', 'investment', 'checking', 'other']} allowEmpty emptyLabel="Não vincular (registrar aportes)" />}
      </Field>
      {!goal && !linkedAccountId && <Field label="Já guardado">{(id) => <MoneyInput id={id} value={initial} onChange={(e) => setInitial(e.target.value)} />}</Field>}
      <FormActions error={save.error ?? remove.error}>
        {goal && (
          <Button variant="danger" className="mr-auto" onClick={() => remove.mutate(undefined)}>
            Cancelar meta
          </Button>
        )}
        <Button onClick={onDone}>Fechar</Button>
        <Button type="submit" variant="primary" disabled={save.isPending}>
          Salvar
        </Button>
      </FormActions>
    </form>
  );
}

function ContributionForm({ goal, onDone }: { goal: Goal; onDone: () => void }) {
  const [amount, setAmount] = useState(moneyToInput(goal.monthlyContribution));
  const [date, setDate] = useState(todayISO());
  const [withdraw, setWithdraw] = useState(false);
  const save = useAction((body: object) => post(`/goals/${goal.id}/contributions`, body), onDone);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const v = parseMoneyInput(amount)?.replace('-', '');
        if (v) save.mutate({ amount: withdraw ? `-${v}` : v, date });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Valor">{(id) => <MoneyInput id={id} value={amount} onChange={(e) => setAmount(e.target.value)} required />}</Field>
        <Field label="Data">{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />}</Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={withdraw} onChange={(e) => setWithdraw(e.target.checked)} className="size-4 accent-[var(--accent)]" />É um resgate (retirada da meta)
      </label>
      <FormActions error={save.error}>
        <Button onClick={onDone}>Cancelar</Button>
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {withdraw ? 'Registrar resgate' : 'Registrar aporte'}
        </Button>
      </FormActions>
    </form>
  );
}

function ProjectionView({ goal }: { goal: Goal }) {
  const [monthly, setMonthly] = useState(moneyToInput(goal.monthlyContribution ?? goal.requiredMonthlyContribution ?? '500.00'));
  const [rate, setRate] = useState(goal.expectedAnnualRate?.replace('.', ',') ?? '0');
  const [debounced, setDebounced] = useState({ monthly, rate });
  useEffect(() => {
    const t = setTimeout(() => setDebounced({ monthly, rate }), 300);
    return () => clearTimeout(t);
  }, [monthly, rate]);
  const value = parseMoneyInput(debounced.monthly)?.replace('-', '');
  const q = useQuery({
    queryKey: ['goal-projection', goal.id, debounced],
    queryFn: () => get<GoalProjection>(`/goals/${goal.id}/projection${qs({ monthlyContribution: value && value !== '0.00' ? value : undefined, annualRate: debounced.rate.replace(',', '.') || undefined })}`),
    placeholderData: (prev) => prev,
  });
  const p = q.data;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_2fr] sm:items-end">
        <Field label="Aporte mensal">{(id) => <MoneyInput id={id} value={monthly} onChange={(e) => setMonthly(e.target.value)} />}</Field>
        <Field label="Rendimento % a.a.">{(id) => <Input id={id} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />}</Field>
        {p && (
          <p className="pb-1 text-sm">
            {p.reached && p.reachedMonth ? (
              <>
                Meta alcançada em <strong>{formatMonthLong(p.reachedMonth)}</strong> ({p.months} {p.months === 1 ? 'mês' : 'meses'}), sendo {formatBRL(p.totalInterest)} de rendimento.
              </>
            ) : (
              'Nesse ritmo a meta não é alcançada em 50 anos.'
            )}
          </p>
        )}
      </div>
      <ErrorNote error={q.error} />
      {p && p.series.length > 0 && (
        <MoneyLineChart
          data={p.series.map((s) => ({ month: s.month, balance: toNumber(s.balance), target: toNumber(goal.targetAmount) }))}
          xKey="month"
          xFormatter={formatMonthShort}
          tooltipLabel={formatMonthLong}
          series={[
            { key: 'balance', label: 'Valor acumulado', slot: 1 },
            { key: 'target', label: 'Objetivo', slot: 'muted', dashed: true },
          ]}
          height={240}
        />
      )}
      {p && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">E se eu mudar o aporte?</h3>
          <Table>
            <thead>
              <tr>
                <Th>Cenário</Th>
                <Th right>Aporte</Th>
                <Th right>Meses</Th>
                <Th right>Conclusão</Th>
              </tr>
            </thead>
            <tbody>
              {p.alternatives.map((a) => (
                <tr key={a.label} className={a.label === 'Atual' ? 'font-medium' : undefined}>
                  <Td>{a.label === 'Atual' ? 'Aporte informado' : a.label}</Td>
                  <Td right>
                    <Money value={a.monthlyContribution} tone="plain" />
                  </Td>
                  <Td right className="num">
                    {a.months ?? '—'}
                  </Td>
                  <Td right>
                    {a.reachedMonth ? formatMonthTitle(a.reachedMonth) : 'Não alcança'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </div>
  );
}
