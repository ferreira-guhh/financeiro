import { useInfiniteQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { del, get, patch, post, qs } from '../api/client';
import { categoryLabel, useAccounts, useAction, useCategories } from '../api/hooks';
import type { Transaction } from '../api/types';
import { AccountSelect, CategorySelect } from '../components/selects';
import { Badge, Button, Empty, ErrorNote, Field, FormActions, Input, Loading, Modal, Money, MoneyInput, PageHeader, Segmented, Select, Table, Td, Th } from '../components/ui';
import { formatDate, moneyToInput, parseMoneyInput, todayISO } from '../lib/format';

const PAYMENT_METHODS: Record<string, string> = {
  pix: 'Pix',
  debit_card: 'Cartão de débito',
  credit_card: 'Cartão de crédito',
  cash: 'Dinheiro',
  bank_slip: 'Boleto',
  bank_transfer: 'TED/DOC',
  auto_debit: 'Débito automático',
  other: 'Outro',
};

const SOURCE_LABEL: Record<string, string> = {
  manual: 'Manual',
  import_ofx: 'OFX',
  import_csv: 'CSV',
  import_xlsx: 'Excel',
  recurring: 'Conta fixa',
  installment: 'Parcela',
  open_finance: 'Open Finance',
};

interface Filters {
  accountId: string;
  type: string;
  status: string;
  from: string;
  to: string;
  search: string;
  categoryId: string;
}

export function TransactionsPage() {
  const [filters, setFilters] = useState<Filters>({ accountId: '', type: '', status: '', from: '', to: '', search: '', categoryId: '' });
  const [creating, setCreating] = useState<null | 'entry' | 'transfer'>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const { data: accounts = [] } = useAccounts(true);
  const { data: categories } = useCategories();
  const label = categoryLabel(categories);
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? '—';

  const list = useInfiniteQuery({
    queryKey: ['transactions', filters],
    queryFn: ({ pageParam }) => get<{ data: Transaction[]; nextCursor: string | null }>(`/transactions${qs({ ...filters, limit: 50, cursor: pageParam })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];

  const confirm = useAction((id: string) => patch(`/transactions/${id}`, { status: 'completed' }));
  const set = (k: keyof Filters) => (v: string) => setFilters((f) => ({ ...f, [k]: v }));

  return (
    <div>
      <PageHeader
        title="Lançamentos"
        description="O livro-caixa: tudo o que entrou e saiu, de todas as contas e cartões."
        actions={
          <>
            <Button onClick={() => setCreating('transfer')}>Transferir</Button>
            <Button variant="primary" onClick={() => setCreating('entry')}>
              Novo lançamento
            </Button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Input placeholder="Buscar descrição" value={filters.search} onChange={(e) => set('search')(e.target.value)} className="lg:col-span-2" aria-label="Buscar" />
        <AccountSelect value={filters.accountId} onChange={set('accountId')} allowEmpty emptyLabel="Todas as contas" />
        <Select value={filters.type} onChange={(e) => set('type')(e.target.value)} aria-label="Tipo">
          <option value="">Todos os tipos</option>
          <option value="income">Receitas</option>
          <option value="expense">Despesas</option>
          <option value="transfer">Transferências</option>
        </Select>
        <Select value={filters.status} onChange={(e) => set('status')(e.target.value)} aria-label="Situação">
          <option value="">Ativos</option>
          <option value="completed">Realizados</option>
          <option value="pending">A confirmar</option>
          <option value="cancelled">Cancelados</option>
        </Select>
        <Select value={filters.categoryId} onChange={(e) => set('categoryId')(e.target.value)} aria-label="Categoria">
          <option value="">Todas as categorias</option>
          <option value="none">Sem categoria</option>
          {(categories ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {label(c.id)}
            </option>
          ))}
        </Select>
        <div className="flex items-center gap-2 lg:col-span-2">
          <Input type="date" value={filters.from} onChange={(e) => set('from')(e.target.value)} aria-label="De" />
          <span className="text-ink-3">até</span>
          <Input type="date" value={filters.to} onChange={(e) => set('to')(e.target.value)} aria-label="Até" />
        </div>
      </div>

      {list.isLoading ? (
        <Loading />
      ) : list.error ? (
        <ErrorNote error={list.error} />
      ) : rows.length === 0 ? (
        <Empty title="Nenhum lançamento encontrado" action={<Button variant="primary" onClick={() => setCreating('entry')}>Novo lançamento</Button>}>
          Ajuste os filtros ou registre o primeiro lançamento.
        </Empty>
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Data</Th>
                <Th>Descrição</Th>
                <Th className="hidden md:table-cell">Categoria</Th>
                <Th className="hidden md:table-cell">Conta</Th>
                <Th right>Valor</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className={t.status === 'cancelled' ? 'opacity-50' : 'hover:bg-paper'}>
                  <Td className="num whitespace-nowrap text-ink-2">{formatDate(t.date)}</Td>
                  <Td>
                    <button type="button" onClick={() => setEditing(t)} className="text-left hover:underline" disabled={t.status === 'cancelled'}>
                      {t.description}
                    </button>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {t.status === 'pending' && <Badge tone="warn">A confirmar</Badge>}
                      {t.status === 'cancelled' && <Badge>Cancelado</Badge>}
                      {t.type === 'transfer' && <Badge tone="accent">Transferência</Badge>}
                      {t.source !== 'manual' && <Badge>{SOURCE_LABEL[t.source] ?? t.source}</Badge>}
                    </div>
                  </Td>
                  <Td className="hidden text-ink-2 md:table-cell">{label(t.categoryId) ?? <span className="text-ink-3">—</span>}</Td>
                  <Td className="hidden text-ink-2 md:table-cell">{accountName(t.accountId)}</Td>
                  <Td right>
                    <Money value={t.amount} sign />
                  </Td>
                  <Td right className="whitespace-nowrap">
                    {t.status === 'pending' && (
                      <Button size="sm" variant="ghost" onClick={() => confirm.mutate(t.id)} disabled={confirm.isPending}>
                        Confirmar
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {list.hasNextPage && (
            <div className="mt-4 text-center">
              <Button onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                {list.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
              </Button>
            </div>
          )}
          <ErrorNote error={confirm.error} />
        </>
      )}

      <Modal open={creating === 'entry'} onClose={() => setCreating(null)} title="Novo lançamento">
        <EntryForm onDone={() => setCreating(null)} />
      </Modal>
      <Modal open={creating === 'transfer'} onClose={() => setCreating(null)} title="Transferência entre contas">
        <TransferForm onDone={() => setCreating(null)} />
      </Modal>
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title="Editar lançamento">
        {editing && <EditForm tx={editing} onDone={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

function EntryForm({ onDone }: { onDone: () => void }) {
  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [pending, setPending] = useState(false);
  const [notes, setNotes] = useState('');
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const action = useAction((body: object) => post('/transactions', body), onDone);
  const isDuplicate = (action.error as { code?: string } | null)?.code === 'DUPLICATE_TRANSACTION';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = parseMoneyInput(amount);
    if (!value) return;
    action.mutate({
      type,
      accountId,
      amount: value.replace('-', ''),
      date,
      description,
      categoryId: categoryId || undefined,
      paymentMethod: paymentMethod || undefined,
      status: pending ? 'pending' : 'completed',
      notes: notes || undefined,
      allowDuplicate,
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Valor" error={amount && !parseMoneyInput(amount) ? 'Use até 2 casas decimais, ex.: 89,90' : undefined}>
          {(id) => <MoneyInput id={id} value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus />}
        </Field>
        <Field label="Data">{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />}</Field>
      </div>
      <Field label="Descrição">{(id) => <Input id={id} value={description} onChange={(e) => setDescription(e.target.value)} required maxLength={255} />}</Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Conta" hint="Compras no cartão são lançadas em Cartões.">
          {(id) => <AccountSelect id={id} value={accountId} onChange={setAccountId} types={['checking', 'savings', 'wallet', 'investment', 'other']} />}
        </Field>
        <Field label="Categoria">{(id) => <CategorySelect id={id} type={type} value={categoryId} onChange={setCategoryId} />}</Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Forma de pagamento">
          {(id) => (
            <Select id={id} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
              <option value="">—</option>
              {Object.entries(PAYMENT_METHODS)
                .filter(([k]) => k !== 'credit_card')
                .map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field label="Observação">{(id) => <Input id={id} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={pending} onChange={(e) => setPending(e.target.checked)} className="size-4 accent-[var(--accent)]" />
        Ainda não foi pago/recebido (fica como “a confirmar”)
      </label>
      {isDuplicate && (
        <label className="flex items-center gap-2 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
          <input type="checkbox" checked={allowDuplicate} onChange={(e) => setAllowDuplicate(e.target.checked)} className="size-4" />É outro lançamento igual, registrar mesmo assim
        </label>
      )}
      <FormActions error={action.error}>
        <Button onClick={onDone}>Cancelar</Button>
        <Button type="submit" variant="primary" disabled={action.isPending || !accountId}>
          Salvar lançamento
        </Button>
      </FormActions>
    </form>
  );
}

function TransferForm({ onDone }: { onDone: () => void }) {
  const [fromAccountId, setFrom] = useState('');
  const [toAccountId, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState('Transferência entre contas');
  const action = useAction((body: object) => post('/transfers', body), onDone);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const value = parseMoneyInput(amount);
        if (value) action.mutate({ fromAccountId, toAccountId, amount: value.replace('-', ''), date, description });
      }}
      className="space-y-4"
    >
      <p className="text-sm text-ink-2">Transferências não contam como receita nem despesa. Para pagar fatura, escolha o cartão como destino.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="De">{(id) => <AccountSelect id={id} value={fromAccountId} onChange={setFrom} types={['checking', 'savings', 'wallet', 'investment', 'other']} />}</Field>
        <Field label="Para">{(id) => <AccountSelect id={id} value={toAccountId} onChange={setTo} />}</Field>
        <Field label="Valor">{(id) => <MoneyInput id={id} value={amount} onChange={(e) => setAmount(e.target.value)} required />}</Field>
        <Field label="Data">{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />}</Field>
      </div>
      <Field label="Descrição">{(id) => <Input id={id} value={description} onChange={(e) => setDescription(e.target.value)} required />}</Field>
      <FormActions error={action.error}>
        <Button onClick={onDone}>Cancelar</Button>
        <Button type="submit" variant="primary" disabled={action.isPending || !fromAccountId || !toAccountId}>
          Transferir
        </Button>
      </FormActions>
    </form>
  );
}

function EditForm({ tx, onDone }: { tx: Transaction; onDone: () => void }) {
  const isTransfer = tx.type === 'transfer';
  const [amount, setAmount] = useState(moneyToInput(tx.amount.replace('-', '')));
  const [date, setDate] = useState(tx.date);
  const [description, setDescription] = useState(tx.description);
  const [categoryId, setCategoryId] = useState(tx.categoryId ?? '');
  const [notes, setNotes] = useState(tx.notes ?? '');
  const [status, setStatus] = useState(tx.status);
  const save = useAction((body: object) => patch(`/transactions/${tx.id}`, body), onDone);
  const cancel = useAction(() => del(`/transactions/${tx.id}`), onDone);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (isTransfer) return save.mutate({ description, notes: notes || null });
    const value = parseMoneyInput(amount);
    const body: Record<string, unknown> = { description, notes: notes || null, categoryId: categoryId || null };
    if (value && value.replace('-', '') !== tx.amount.replace('-', '')) body.amount = value.replace('-', '');
    if (date !== tx.date) body.date = date;
    if (status !== tx.status) body.status = status;
    save.mutate(body);
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-[13px] text-ink-3">Descrição original do banco: {tx.rawDescription}</p>
      {!isTransfer && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Valor">{(id) => <MoneyInput id={id} value={amount} onChange={(e) => setAmount(e.target.value)} disabled={tx.source === 'installment'} />}</Field>
          <Field label="Data">{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={tx.source === 'installment'} />}</Field>
        </div>
      )}
      <Field label="Descrição">{(id) => <Input id={id} value={description} onChange={(e) => setDescription(e.target.value)} required />}</Field>
      {!isTransfer && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Categoria">{(id) => <CategorySelect id={id} type={tx.type as 'income' | 'expense'} value={categoryId} onChange={setCategoryId} />}</Field>
          <Field label="Situação">
            {(id) => (
              <Select id={id} value={status} onChange={(e) => setStatus(e.target.value as Transaction['status'])}>
                <option value="completed">Realizado</option>
                <option value="pending">A confirmar</option>
              </Select>
            )}
          </Field>
        </div>
      )}
      <Field label="Observação">{(id) => <Input id={id} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
      <FormActions error={save.error ?? cancel.error}>
        <Button variant="danger" onClick={() => cancel.mutate(undefined)} disabled={cancel.isPending} className="mr-auto">
          {isTransfer ? 'Cancelar transferência' : 'Cancelar lançamento'}
        </Button>
        <Button onClick={onDone}>Fechar</Button>
        <Button type="submit" variant="primary" disabled={save.isPending}>
          Salvar alterações
        </Button>
      </FormActions>
    </form>
  );
}
