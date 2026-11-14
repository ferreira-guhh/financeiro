import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { del, get, patch, post } from '../api/client';
import { categoryLabel, useAction, useCategories } from '../api/hooks';
import type { List, Recurring, RecurringSuggestion, UpcomingItem } from '../api/types';
import { AccountSelect, CategorySelect } from '../components/selects';
import { Badge, Button, Checkbox, Empty, ErrorNote, Field, FormActions, Input, Loading, Modal, Money, MoneyInput, PageHeader, Segmented, Select, SectionTitle, Table, Td, Th } from '../components/ui';
import { formatBRL, formatDate, formatDayMonth, moneyToInput, parseMoneyInput, todayISO } from '../lib/format';

const FREQ: Record<Recurring['frequency'], string> = { weekly: 'Semanal', monthly: 'Mensal', yearly: 'Anual' };

function cadence(r: Pick<Recurring, 'frequency' | 'interval' | 'dayOfMonth'>) {
  if (r.frequency === 'monthly') return r.interval === 1 ? `Todo dia ${r.dayOfMonth}` : `A cada ${r.interval} meses, dia ${r.dayOfMonth}`;
  if (r.frequency === 'weekly') return r.interval === 1 ? 'Toda semana' : `A cada ${r.interval} semanas`;
  return `Anual, dia ${r.dayOfMonth}`;
}

export function RecurringPage() {
  const list = useQuery({ queryKey: ['recurring'], queryFn: () => get<List<Recurring>>('/recurring'), select: (r) => r.data });
  const upcoming = useQuery({ queryKey: ['upcoming', 45], queryFn: () => get<List<UpcomingItem>>('/recurring/upcoming?days=45'), select: (r) => r.data });
  const suggestions = useQuery({ queryKey: ['recurring-suggestions'], queryFn: () => get<List<RecurringSuggestion>>('/recurring/suggestions'), select: (r) => r.data });
  const { data: categories } = useCategories();
  const label = categoryLabel(categories);
  const [editing, setEditing] = useState<Recurring | 'new' | RecurringSuggestion | null>(null);
  const confirm = useAction((id: string) => patch(`/transactions/${id}`, { status: 'completed' }));

  const incomes = list.data?.filter((r) => r.type === 'income') ?? [];
  const expenses = list.data?.filter((r) => r.type === 'expense') ?? [];
  const sum = (rs: Recurring[]) => rs.reduce((a, r) => a + Number(r.monthlyEquivalent), 0).toFixed(2);

  return (
    <div className="space-y-10">
      <PageHeader
        title="Contas fixas"
        description="Receitas e despesas que se repetem. Cada ocorrência entra no livro-caixa no dia, como “a confirmar” — até lá é só previsão."
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            Nova conta fixa
          </Button>
        }
      />

      {suggestions.data && suggestions.data.length > 0 && (
        <section className="rounded-lg border border-accent/30 bg-accent-soft p-5">
          <SectionTitle>Encontramos possíveis contas fixas no seu histórico</SectionTitle>
          <ul className="space-y-2">
            {suggestions.data.map((s) => (
              <li key={`${s.accountId}-${s.description}`} className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <span>
                  <strong className="font-medium">{s.description}</strong> — {formatBRL(s.amount)} todo dia {s.dayOfMonth}
                  <span className="text-ink-2"> ({s.occurrences} vezes, variação de {s.amountVariationPercent.replace('.', ',')}%)</span>
                </span>
                <Button size="sm" onClick={() => setEditing(s)}>
                  Criar conta fixa
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-8">
          {list.isLoading ? (
            <Loading />
          ) : list.error ? (
            <ErrorNote error={list.error} />
          ) : !list.data?.length ? (
            <Empty title="Nenhuma conta fixa" action={<Button variant="primary" onClick={() => setEditing('new')}>Nova conta fixa</Button>}>
              Salário, aluguel, internet, assinaturas — cadastre uma vez e o sistema prevê os próximos meses.
            </Empty>
          ) : (
            [
              { title: 'Despesas fixas', rows: expenses },
              { title: 'Receitas fixas', rows: incomes },
            ]
              .filter((g) => g.rows.length)
              .map((g) => (
                <section key={g.title}>
                  <SectionTitle aside={<span className="num">{formatBRL(sum(g.rows))}/mês</span>}>{g.title}</SectionTitle>
                  <Table>
                    <thead>
                      <tr>
                        <Th>Descrição</Th>
                        <Th className="hidden sm:table-cell">Quando</Th>
                        <Th className="hidden md:table-cell">Próxima</Th>
                        <Th right>Valor</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map((r) => (
                        <tr key={r.id} className="hover:bg-paper">
                          <Td>
                            <button type="button" className="text-left font-medium hover:underline" onClick={() => setEditing(r)}>
                              {r.description}
                            </button>
                            <div className="text-[12px] text-ink-3">
                              {r.accountName}
                              {r.categoryId && ` · ${label(r.categoryId)}`}
                              {r.autoConfirm && ' · confirma sozinho'}
                            </div>
                          </Td>
                          <Td className="hidden whitespace-nowrap text-ink-2 sm:table-cell">{cadence(r)}</Td>
                          <Td className="num hidden text-ink-2 md:table-cell">{r.nextOccurrence ? formatDate(r.nextOccurrence) : '—'}</Td>
                          <Td right>
                            <Money value={r.amount} tone="plain" />
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </section>
              ))
          )}
        </div>

        <section>
          <SectionTitle aside="45 dias">A pagar e a receber</SectionTitle>
          {upcoming.data?.length === 0 && <p className="text-sm text-ink-3">Nada nos próximos dias.</p>}
          <ul className="tabular divide-y divide-rule border-y border-rule">
            {upcoming.data?.map((u, i) => (
              <li key={`${u.date}-${u.description}-${i}`} className="flex items-center gap-3 py-2.5 text-sm">
                <span className={`num w-14 shrink-0 ${u.overdue ? 'font-medium text-neg' : 'text-ink-2'}`}>{formatDayMonth(u.date)}</span>
                <span className="min-w-0 flex-1 truncate">{u.description}</span>
                {u.kind === 'pending' && u.transactionId ? (
                  <Button size="sm" variant="ghost" onClick={() => confirm.mutate(u.transactionId!)} title="Marcar como pago/recebido">
                    {u.overdue ? <Badge tone="neg">Confirmar</Badge> : <Badge tone="warn">Confirmar</Badge>}
                  </Button>
                ) : null}
                <Money value={u.amount} sign className="w-28 text-right" />
              </li>
            ))}
          </ul>
          <ErrorNote error={confirm.error} />
        </section>
      </div>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing && editing !== 'new' && 'id' in editing ? 'Editar conta fixa' : 'Nova conta fixa'}>
        {editing && <RecurringForm initial={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

function RecurringForm({ initial, onDone }: { initial: Recurring | RecurringSuggestion | null; onDone: () => void }) {
  const existing = initial && 'id' in initial ? initial : null;
  const [type, setType] = useState<'income' | 'expense'>(initial?.type ?? 'expense');
  const [accountId, setAccountId] = useState(initial?.accountId ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [amount, setAmount] = useState(moneyToInput(initial?.amount));
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '');
  const [frequency, setFrequency] = useState<Recurring['frequency']>(existing?.frequency ?? 'monthly');
  const [dayOfMonth, setDay] = useState(String(initial?.dayOfMonth ?? new Date().getDate()));
  const [startDate, setStartDate] = useState(todayISO().slice(0, 8) + '01');
  const [endDate, setEndDate] = useState(existing?.endDate ?? '');
  const [autoConfirm, setAutoConfirm] = useState(existing?.autoConfirm ?? false);
  const [backfill, setBackfill] = useState(false);
  const save = useAction((body: object) => (existing ? patch(`/recurring/${existing.id}`, body) : post('/recurring', body)), onDone);
  const remove = useAction(() => del(`/recurring/${existing!.id}`), onDone);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = parseMoneyInput(amount)?.replace('-', '');
    if (existing) {
      save.mutate({ description, amount: value, categoryId: categoryId || null, dayOfMonth: Number(dayOfMonth), endDate: endDate || null, autoConfirm });
    } else {
      save.mutate({
        type,
        accountId,
        description,
        amount: value,
        categoryId: categoryId || undefined,
        frequency,
        dayOfMonth: frequency === 'weekly' ? undefined : Number(dayOfMonth),
        startDate,
        endDate: endDate || undefined,
        autoConfirm,
        backfill,
      });
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {!existing && (
        <Segmented
          value={type}
          onChange={(v) => {
            setType(v);
            setCategoryId('');
          }}
          options={[
            { value: 'expense', label: 'Despesa' },
            { value: 'income', label: 'Receita' },
          ]}
        />
      )}
      <Field label="Descrição">{(id) => <Input id={id} value={description} onChange={(e) => setDescription(e.target.value)} required />}</Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Valor" hint="Para contas variáveis (luz, água), use uma estimativa.">
          {(id) => <MoneyInput id={id} value={amount} onChange={(e) => setAmount(e.target.value)} required />}
        </Field>
        {!existing && <Field label="Conta ou cartão">{(id) => <AccountSelect id={id} value={accountId} onChange={setAccountId} />}</Field>}
        <Field label="Categoria">{(id) => <CategorySelect id={id} type={type} value={categoryId} onChange={setCategoryId} />}</Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {!existing && (
          <Field label="Frequência">
            {(id) => (
              <Select id={id} value={frequency} onChange={(e) => setFrequency(e.target.value as Recurring['frequency'])}>
                {Object.entries(FREQ).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {frequency !== 'weekly' && (
          <Field label="Dia do mês" hint="31 = último dia">
            {(id) => <Input id={id} type="number" min={1} max={31} value={dayOfMonth} onChange={(e) => setDay(e.target.value)} required />}
          </Field>
        )}
        {!existing && <Field label="Começa em">{(id) => <Input id={id} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />}</Field>}
        <Field label="Termina em" hint="Opcional">
          {(id) => <Input id={id} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />}
        </Field>
      </div>
      <Checkbox label="Confirmar automaticamente" hint="Para débito automático garantido: entra como realizado, sem precisar confirmar." checked={autoConfirm} onChange={setAutoConfirm} />
      {!existing && startDate < todayISO().slice(0, 8) + '01' && (
        <Checkbox label="Gerar o histórico desde a data de início" hint="Os meses passados entram como já realizados (máx. 24 meses)." checked={backfill} onChange={setBackfill} />
      )}
      <FormActions error={save.error ?? remove.error}>
        {existing && (
          <Button variant="danger" className="mr-auto" onClick={() => remove.mutate(undefined)}>
            Encerrar
          </Button>
        )}
        <Button onClick={onDone}>Cancelar</Button>
        <Button type="submit" variant="primary" disabled={save.isPending || (!existing && !accountId)}>
          Salvar
        </Button>
      </FormActions>
    </form>
  );
}
