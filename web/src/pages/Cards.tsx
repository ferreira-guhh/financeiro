import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { get, patch, post } from '../api/client';
import { categoryLabel, useAction, useCards, useCategories } from '../api/hooks';
import type { CreditCard, InvoiceItem, InvoiceSummary, List } from '../api/types';
import { AccountSelect, CategorySelect } from '../components/selects';
import { Badge, Button, Empty, ErrorNote, Field, FormActions, Input, Loading, Modal, Money, MoneyInput, PageHeader, ProgressBar, Segmented, Stat, Table, Td, Th, cx } from '../components/ui';
import { formatBRL, formatDate, formatMonthLong, formatMonthTitle, moneyToInput, parseMoneyInput, todayISO, toNumber } from '../lib/format';

const STATUS = {
  open: { label: 'Aberta', tone: 'neutral' },
  closed: { label: 'Fechada', tone: 'warn' },
  paid: { label: 'Paga', tone: 'pos' },
  overdue: { label: 'Vencida', tone: 'neg' },
} as const;

const ITEM_KIND: Record<InvoiceItem['kind'], string | null> = {
  transaction: null,
  scheduled_installment: 'Parcela futura',
  projected_recurring: 'Prevista',
  payment: 'Pagamento',
};

export function CardsPage() {
  const cards = useCards();
  const [selected, setSelected] = useState<string | null>(null);
  const [modal, setModal] = useState<null | 'new' | 'edit' | 'purchase'>(null);
  const card = cards.data?.find((c) => c.id === selected) ?? cards.data?.[0];

  useEffect(() => {
    if (!selected && cards.data?.[0]) setSelected(cards.data[0].id);
  }, [cards.data, selected]);

  return (
    <div>
      <PageHeader
        title="Cartões"
        description="Cada compra cai na fatura certa pela data de fechamento. Parcelas futuras já ocupam o limite."
        actions={
          <>
            <Button onClick={() => setModal('new')}>Novo cartão</Button>
            {card && (
              <Button variant="primary" onClick={() => setModal('purchase')}>
                Lançar compra
              </Button>
            )}
          </>
        }
      />
      {cards.isLoading ? (
        <Loading />
      ) : cards.error ? (
        <ErrorNote error={cards.error} />
      ) : !card ? (
        <Empty title="Nenhum cartão cadastrado" action={<Button variant="primary" onClick={() => setModal('new')}>Novo cartão</Button>}>
          Informe limite, dia de fechamento e de vencimento para o sistema montar as faturas.
        </Empty>
      ) : (
        <>
          {cards.data!.length > 1 && (
            <div className="mb-6 flex flex-wrap gap-2">
              {cards.data!.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelected(c.id)}
                  className={cx('rounded-md border px-3 py-1.5 text-sm', c.id === card.id ? 'border-ink bg-surface font-medium' : 'border-rule text-ink-2 hover:border-rule-strong')}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
          <CardDetail card={card} onEdit={() => setModal('edit')} />
        </>
      )}

      <Modal open={modal === 'new' || modal === 'edit'} onClose={() => setModal(null)} title={modal === 'edit' ? 'Editar cartão' : 'Novo cartão'}>
        <CardForm card={modal === 'edit' ? (card ?? null) : null} onDone={() => setModal(null)} />
      </Modal>
      <Modal open={modal === 'purchase'} onClose={() => setModal(null)} title={`Compra no ${card?.name ?? 'cartão'}`}>
        {card && <PurchaseForm card={card} onDone={() => setModal(null)} />}
      </Modal>
    </div>
  );
}

function CardDetail({ card, onEdit }: { card: CreditCard; onEdit: () => void }) {
  const invoices = useQuery({ queryKey: ['invoices', card.id], queryFn: () => get<List<InvoiceSummary>>(`/credit-cards/${card.id}/invoices`) });
  const [openKey, setOpenKey] = useState<string | null>(null);
  const list = invoices.data?.data ?? [];
  const defaultKey = card.nextDueInvoice?.key ?? card.currentInvoice?.key ?? null;
  const activeKey = openKey ?? defaultKey;
  const used = toNumber(card.usedLimit);
  const limit = Math.max(toNumber(card.creditLimit), 1);

  // Mostra as últimas 3 + atual + futuras com valor.
  const visible = list.filter((i) => i.key >= (list.find((x) => x.status === 'closed' || x.status === 'overdue')?.key ?? '0') || toNumber(i.total) > 0).slice(-12);

  return (
    <div className="space-y-8">
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Limite disponível" value={<Money value={card.availableLimit} />} hint={`de ${formatBRL(card.creditLimit)}`} />
        <Stat label="Fatura atual" value={<Money value={card.currentInvoice?.total ?? '0'} />} hint={card.currentInvoice ? `fecha ${formatDate(card.currentInvoice.closingDate)}` : undefined} />
        <Stat label="Próximo pagamento" value={<Money value={card.nextDueInvoice?.remaining ?? '0'} />} hint={card.nextDueInvoice ? `vence ${formatDate(card.nextDueInvoice.dueDate)}` : undefined} />
        <div>
          <div className="text-sm text-ink-2">Ciclo</div>
          <div className="mt-0.5 text-[15px]">
            Fecha dia {card.closingDay}, vence dia {card.dueDay}
          </div>
          <button type="button" onClick={onEdit} className="mt-1 text-[13px] text-accent hover:underline">
            Editar cartão
          </button>
        </div>
      </div>
      <div>
        <ProgressBar value={(used / limit) * 100} tone={toNumber(card.availableLimit) < 0 ? 'neg' : 'accent'} />
        <p className="mt-1 text-[13px] text-ink-3">Usado {formatBRL(card.usedLimit)}, incluindo parcelas que ainda vão vencer.</p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
        <div>
          <h2 className="mb-2 text-[17px] font-semibold">Faturas</h2>
          {invoices.isLoading ? (
            <Loading />
          ) : (
            <ul className="tabular divide-y divide-rule border-y border-rule">
              {visible.map((i) => (
                <li key={i.key}>
                  <button
                    type="button"
                    onClick={() => setOpenKey(i.key)}
                    className={cx('flex w-full items-center justify-between gap-2 px-2 py-2.5 text-left text-sm', i.key === activeKey ? 'bg-surface shadow-[inset_2px_0_0_var(--accent)]' : 'hover:bg-sunken')}
                  >
                    <span>
                      <span className="block font-medium">{formatMonthTitle(i.key)}</span>
                      <span className="text-[12px] text-ink-3">vence {formatDate(i.dueDate)}</span>
                    </span>
                    <span className="text-right">
                      <Money value={toNumber(i.projectedRecurring) ? String((toNumber(i.total) + toNumber(i.projectedRecurring)).toFixed(2)) : i.total} className="block" />
                      <Badge tone={STATUS[i.status].tone}>{STATUS[i.status].label}</Badge>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {activeKey && <InvoiceDetail card={card} invoiceKey={activeKey} />}
      </div>
    </div>
  );
}

function InvoiceDetail({ card, invoiceKey }: { card: CreditCard; invoiceKey: string }) {
  const [year, month] = invoiceKey.split('-');
  const q = useQuery({
    queryKey: ['invoice', card.id, invoiceKey],
    queryFn: () => get<InvoiceSummary & { items: InvoiceItem[] }>(`/credit-cards/${card.id}/invoices/${Number(year)}/${Number(month)}`),
  });
  const { data: categories } = useCategories();
  const label = categoryLabel(categories);
  const [paying, setPaying] = useState(false);
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorNote error={q.error} />;
  const inv = q.data;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold">Fatura de {formatMonthLong(invoiceKey)}</h2>
          <p className="text-sm text-ink-2">
            Fecha {formatDate(inv.closingDate)} · vence {formatDate(inv.dueDate)}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-[13px] text-ink-2">{inv.status === 'paid' ? 'Total pago' : 'A pagar'}</div>
            <Money value={inv.status === 'paid' ? inv.paid : inv.remaining} className="text-[21px] font-semibold" />
          </div>
          {inv.status !== 'paid' && toNumber(inv.remaining) > 0 && (
            <Button variant="primary" onClick={() => setPaying(true)}>
              Pagar fatura
            </Button>
          )}
        </div>
      </div>
      {toNumber(inv.projectedRecurring) > 0 && (
        <p className="mb-3 text-[13px] text-ink-3">Inclui {formatBRL(inv.projectedRecurring)} de assinaturas previstas que ainda não foram cobradas.</p>
      )}
      {inv.items.length === 0 ? (
        <Empty title="Fatura sem lançamentos" />
      ) : (
        <Table>
          <tbody>
            {inv.items.map((it, i) => (
              <tr key={`${it.id}-${i}`} className={it.kind !== 'transaction' ? 'text-ink-2' : undefined}>
                <Td className="num w-24 whitespace-nowrap text-ink-2">{formatDate(it.date)}</Td>
                <Td>
                  {it.description}
                  {ITEM_KIND[it.kind] && (
                    <span className="ml-2">
                      <Badge tone={it.kind === 'payment' ? 'pos' : 'neutral'}>{ITEM_KIND[it.kind]}</Badge>
                    </span>
                  )}
                </Td>
                <Td className="hidden text-ink-3 md:table-cell">{label(it.categoryId)}</Td>
                <Td right>
                  <Money value={it.amount} tone={it.kind === 'payment' ? 'muted' : 'plain'} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Modal open={paying} onClose={() => setPaying(false)} title={`Pagar fatura de ${formatMonthLong(invoiceKey)}`}>
        <PayForm card={card} inv={inv} onDone={() => setPaying(false)} />
      </Modal>
    </div>
  );
}

function PayForm({ card, inv, onDone }: { card: CreditCard; inv: InvoiceSummary; onDone: () => void }) {
  const [fromAccountId, setFrom] = useState(card.paymentAccountId ?? '');
  const [amount, setAmount] = useState(moneyToInput(inv.remaining));
  const [date, setDate] = useState(todayISO() < inv.dueDate ? todayISO() : inv.dueDate);
  const pay = useAction((body: object) => post(`/credit-cards/${card.id}/invoices/${inv.year}/${inv.month}/payments`, body), onDone);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        pay.mutate({ fromAccountId, amount: parseMoneyInput(amount) ?? undefined, date });
      }}
    >
      <p className="text-sm text-ink-2">O pagamento é uma transferência da conta escolhida para o cartão — não conta como despesa de novo.</p>
      <Field label="Pagar com">{(id) => <AccountSelect id={id} value={fromAccountId} onChange={setFrom} types={['checking', 'savings', 'wallet', 'other']} />}</Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Valor" hint="Pode ser parcial.">
          {(id) => <MoneyInput id={id} value={amount} onChange={(e) => setAmount(e.target.value)} required />}
        </Field>
        <Field label="Data">{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />}</Field>
      </div>
      <FormActions error={pay.error}>
        <Button onClick={onDone}>Cancelar</Button>
        <Button type="submit" variant="primary" disabled={pay.isPending || !fromAccountId}>
          Registrar pagamento
        </Button>
      </FormActions>
    </form>
  );
}

function CardForm({ card, onDone }: { card: CreditCard | null; onDone: () => void }) {
  const [name, setName] = useState(card?.name ?? '');
  const [limit, setLimit] = useState(moneyToInput(card?.creditLimit));
  const [closingDay, setClosingDay] = useState(String(card?.closingDay ?? ''));
  const [dueDay, setDueDay] = useState(String(card?.dueDay ?? ''));
  const [paymentAccountId, setPaymentAccountId] = useState(card?.paymentAccountId ?? '');
  const save = useAction((body: object) => (card ? patch(`/credit-cards/${card.id}`, body) : post('/credit-cards', body)), onDone);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({
      name,
      creditLimit: parseMoneyInput(limit),
      closingDay: Number(closingDay),
      dueDay: Number(dueDay),
      paymentAccountId: paymentAccountId || (card ? null : undefined),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Nome">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} required />}</Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Limite">{(id) => <MoneyInput id={id} value={limit} onChange={(e) => setLimit(e.target.value)} required />}</Field>
        <Field label="Dia do fechamento">{(id) => <Input id={id} type="number" min={1} max={31} value={closingDay} onChange={(e) => setClosingDay(e.target.value)} required />}</Field>
        <Field label="Dia do vencimento">{(id) => <Input id={id} type="number" min={1} max={31} value={dueDay} onChange={(e) => setDueDay(e.target.value)} required />}</Field>
      </div>
      <Field label="Conta que paga a fatura">{(id) => <AccountSelect id={id} value={paymentAccountId} onChange={setPaymentAccountId} types={['checking', 'savings', 'wallet', 'other']} allowEmpty emptyLabel="Nenhuma" />}</Field>
      {card && <p className="text-[13px] text-ink-3">Mudanças no ciclo valem para as próximas faturas; as existentes mantêm suas datas.</p>}
      <FormActions error={save.error}>
        <Button onClick={onDone}>Cancelar</Button>
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {card ? 'Salvar' : 'Cadastrar cartão'}
        </Button>
      </FormActions>
    </form>
  );
}

function PurchaseForm({ card, onDone }: { card: CreditCard; onDone: () => void }) {
  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [installments, setInstallments] = useState('1');
  const [categoryId, setCategoryId] = useState('');
  const action = useAction((body: object) => post(`/credit-cards/${card.id}/purchases`, body), onDone);
  const n = Number(installments) || 1;
  const value = parseMoneyInput(amount);
  const perInstallment = value && n > 1 ? (Number(value) / n).toFixed(2) : null;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!value) return;
        action.mutate({ type, description, amount: value.replace('-', ''), date, installments: type === 'income' ? 1 : n, categoryId: categoryId || undefined });
      }}
    >
      <Segmented
        value={type}
        onChange={(v) => {
          setType(v);
          setCategoryId('');
        }}
        options={[
          { value: 'expense', label: 'Compra' },
          { value: 'income', label: 'Estorno / cashback' },
        ]}
      />
      <Field label="Descrição">{(id) => <Input id={id} value={description} onChange={(e) => setDescription(e.target.value)} required />}</Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Valor total">{(id) => <MoneyInput id={id} value={amount} onChange={(e) => setAmount(e.target.value)} required />}</Field>
        <Field label="Data da compra">{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />}</Field>
        {type === 'expense' && (
          <Field label="Parcelas" hint={perInstallment ? `${n}× de ~${formatBRL(perInstallment)}` : 'À vista = 1'}>
            {(id) => <Input id={id} type="number" min={1} max={420} value={installments} onChange={(e) => setInstallments(e.target.value)} />}
          </Field>
        )}
      </div>
      <Field label="Categoria">{(id) => <CategorySelect id={id} type={type} value={categoryId} onChange={setCategoryId} />}</Field>
      <FormActions error={action.error}>
        <Button onClick={onDone}>Cancelar</Button>
        <Button type="submit" variant="primary" disabled={action.isPending}>
          {n > 1 && type === 'expense' ? `Lançar em ${n}×` : 'Lançar'}
        </Button>
      </FormActions>
    </form>
  );
}
