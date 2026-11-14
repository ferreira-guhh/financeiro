import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { del, get, post } from '../api/client';
import { categoryLabel, useAction, useCategories } from '../api/hooks';
import type { InstallmentPlan, List, Schedule } from '../api/types';
import { MoneyBarChart } from '../components/charts';
import { AccountSelect, CategorySelect } from '../components/selects';
import { Badge, Button, Checkbox, Empty, ErrorNote, Field, FormActions, Input, Loading, Modal, Money, MoneyInput, PageHeader, ProgressBar, SectionTitle, Segmented, Table, Td, Th } from '../components/ui';
import { formatBRL, formatDate, formatMonthLong, formatMonthTitle, formatMonthShort, parseMoneyInput, todayISO, toNumber } from '../lib/format';

export function InstallmentsPage() {
  const [status, setStatus] = useState<'active' | 'completed' | 'cancelled'>('active');
  const plans = useQuery({ queryKey: ['installment-plans', status], queryFn: () => get<List<InstallmentPlan>>(`/installment-plans?status=${status}`), select: (r) => r.data });
  const schedule = useQuery({ queryKey: ['installment-schedule'], queryFn: () => get<Schedule>('/installment-plans/schedule?months=12') });
  const { data: categories } = useCategories();
  const label = categoryLabel(categories);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-10">
      <PageHeader
        title="Parcelamentos"
        description="Cada compra parcelada é um plano: só a parcela do mês entra no livro-caixa; as futuras ficam como projeção."
        actions={<Button onClick={() => setCreating(true)}>Carnê ou boleto parcelado</Button>}
      />

      {schedule.data && (
        <section>
          <SectionTitle aside={<span className="num">{formatBRL(schedule.data.totalCommitted)} nos próximos 12 meses</span>}>Compromisso mensal com parcelas</SectionTitle>
          <MoneyBarChart
            data={schedule.data.months.map((m) => ({ month: m.month, total: toNumber(m.total) }))}
            xKey="month"
            xFormatter={formatMonthShort}
            tooltipLabel={formatMonthLong}
            series={[{ key: 'total', label: 'Parcelas', slot: 2 }]}
            height={200}
          />
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[17px] font-semibold">Planos</h2>
          <Segmented
            value={status}
            onChange={setStatus}
            options={[
              { value: 'active', label: 'Em andamento' },
              { value: 'completed', label: 'Quitados' },
              { value: 'cancelled', label: 'Cancelados' },
            ]}
          />
        </div>
        {plans.isLoading ? (
          <Loading />
        ) : plans.error ? (
          <ErrorNote error={plans.error} />
        ) : !plans.data?.length ? (
          <Empty title="Nenhum parcelamento aqui">Compras parceladas no cartão são criadas em Cartões → Lançar compra.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Compra</Th>
                <Th className="hidden md:table-cell">Progresso</Th>
                <Th right className="hidden sm:table-cell">Parcela</Th>
                <Th right>Falta pagar</Th>
              </tr>
            </thead>
            <tbody>
              {plans.data.map((p) => (
                <tr key={p.id} className="hover:bg-paper">
                  <Td>
                    <button type="button" className="text-left font-medium hover:underline" onClick={() => setOpen(p.id)}>
                      {p.description}
                    </button>
                    <div className="text-[12px] text-ink-3">
                      {p.accountName} · {formatBRL(p.totalAmount)} em {p.installmentCount}×{p.categoryId && ` · ${label(p.categoryId)}`}
                    </div>
                  </Td>
                  <Td className="hidden w-56 md:table-cell">
                    <div className="mb-1 text-[13px] text-ink-2">
                      {p.currentInstallment} de {p.installmentCount}
                      {p.nextDate && <span className="text-ink-3"> · próxima {formatDate(p.nextDate)}</span>}
                    </div>
                    <ProgressBar value={(p.currentInstallment / p.installmentCount) * 100} />
                  </Td>
                  <Td right className="hidden sm:table-cell">
                    <Money value={p.installmentAmount} tone="plain" />
                  </Td>
                  <Td right>
                    <Money value={p.remainingAmount} tone="plain" />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title="Parcelamento" wide>
        {open && <PlanDetail id={open} onDone={() => setOpen(null)} />}
      </Modal>
      <Modal open={creating} onClose={() => setCreating(false)} title="Carnê ou boleto parcelado">
        <PlanForm onDone={() => setCreating(false)} />
      </Modal>
    </div>
  );
}

function PlanDetail({ id, onDone }: { id: string; onDone: () => void }) {
  const q = useQuery({ queryKey: ['installment-plan', id], queryFn: () => get<InstallmentPlan>(`/installment-plans/${id}`) });
  const [cancelPosted, setCancelPosted] = useState(false);
  const cancel = useAction(() => del(`/installment-plans/${id}?cancelPosted=${cancelPosted}`), onDone);
  if (!q.data) return <Loading />;
  const p = q.data;
  const STATUS = { scheduled: ['Agendada', 'neutral'], posted: ['Lançada', 'pos'], cancelled: ['Cancelada', 'neg'] } as const;
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-4">
        <div>
          <div className="text-[13px] text-ink-2">Compra</div>
          <div className="font-medium">{p.description}</div>
        </div>
        <div>
          <div className="text-[13px] text-ink-2">Total</div>
          <Money value={p.totalAmount} tone="plain" className="font-medium" />
        </div>
        <div>
          <div className="text-[13px] text-ink-2">Já lançado</div>
          <Money value={p.postedAmount} tone="plain" className="font-medium" />
        </div>
        <div>
          <div className="text-[13px] text-ink-2">Falta</div>
          <Money value={p.remainingAmount} tone="plain" className="font-medium" />
        </div>
      </div>
      <Table>
        <thead>
          <tr>
            <Th>Parcela</Th>
            <Th>Data</Th>
            <Th className="hidden sm:table-cell">Fatura</Th>
            <Th>Situação</Th>
            <Th right>Valor</Th>
          </tr>
        </thead>
        <tbody>
          {p.installments?.map((i) => (
            <tr key={i.id}>
              <Td className="num">
                {i.number}/{p.installmentCount}
              </Td>
              <Td className="num text-ink-2">{formatDate(i.date)}</Td>
              <Td className="hidden text-ink-2 sm:table-cell">{i.invoiceKey ? formatMonthTitle(i.invoiceKey) : '—'}</Td>
              <Td>
                <Badge tone={STATUS[i.status][1]}>{STATUS[i.status][0]}</Badge>
              </Td>
              <Td right>
                <Money value={i.amount} tone="plain" />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {p.status === 'active' && (
        <div className="space-y-3 border-t border-rule pt-4">
          <Checkbox label="Também cancelar parcelas já lançadas em faturas abertas" hint="Use quando a compra inteira foi cancelada/estornada." checked={cancelPosted} onChange={setCancelPosted} />
          <FormActions error={cancel.error}>
            <Button variant="danger" onClick={() => cancel.mutate(undefined)} disabled={cancel.isPending}>
              Cancelar parcelamento
            </Button>
          </FormActions>
        </div>
      )}
    </div>
  );
}

function PlanForm({ onDone }: { onDone: () => void }) {
  const [accountId, setAccountId] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<'total' | 'installment'>('total');
  const [amount, setAmount] = useState('');
  const [count, setCount] = useState('10');
  const [purchaseDate, setDate] = useState(todayISO());
  const [categoryId, setCategoryId] = useState('');
  const save = useAction((body: object) => post('/installment-plans', body), onDone);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = parseMoneyInput(amount)?.replace('-', '');
    save.mutate({
      accountId,
      description,
      installmentCount: Number(count),
      purchaseDate,
      categoryId: categoryId || undefined,
      ...(mode === 'total' ? { totalAmount: value } : { installmentAmount: value }),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-ink-2">Cada parcela entra como “a confirmar” na data, na conta escolhida.</p>
      <Field label="Descrição">{(id) => <Input id={id} value={description} onChange={(e) => setDescription(e.target.value)} required />}</Field>
      <Field label="Conta que paga">{(id) => <AccountSelect id={id} value={accountId} onChange={setAccountId} types={['checking', 'savings', 'wallet', 'other']} />}</Field>
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: 'total', label: 'Informar total' },
          { value: 'installment', label: 'Informar parcela (com juros)' },
        ]}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={mode === 'total' ? 'Valor total' : 'Valor da parcela'}>{(id) => <MoneyInput id={id} value={amount} onChange={(e) => setAmount(e.target.value)} required />}</Field>
        <Field label="Parcelas">{(id) => <Input id={id} type="number" min={2} max={420} value={count} onChange={(e) => setCount(e.target.value)} required />}</Field>
        <Field label="1ª parcela">{(id) => <Input id={id} type="date" value={purchaseDate} onChange={(e) => setDate(e.target.value)} required />}</Field>
      </div>
      <Field label="Categoria">{(id) => <CategorySelect id={id} type="expense" value={categoryId} onChange={setCategoryId} />}</Field>
      <FormActions error={save.error}>
        <Button onClick={onDone}>Cancelar</Button>
        <Button type="submit" variant="primary" disabled={save.isPending || !accountId}>
          Criar parcelamento
        </Button>
      </FormActions>
    </form>
  );
}
