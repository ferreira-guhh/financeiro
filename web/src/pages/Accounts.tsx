import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { del, get, patch, post } from '../api/client';
import { useAction } from '../api/hooks';
import type { Account } from '../api/types';
import { ACCOUNT_TYPE_LABEL } from '../components/selects';
import { Badge, Button, Empty, ErrorNote, Field, FormActions, Input, Loading, Modal, Money, MoneyInput, PageHeader, Select, Table, Td, Th } from '../components/ui';
import { formatBRL, moneyToInput, parseMoneyInput } from '../lib/format';

export function AccountsPage() {
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const q = useQuery({
    queryKey: ['accounts-page', showArchived],
    queryFn: () => get<{ data: Account[]; totals: { byCurrency: { currency: string; balance: string; projectedBalance: string }[] } }>(`/accounts?includeInactive=${showArchived}`),
  });

  return (
    <div>
      <PageHeader
        title="Contas"
        description="Saldo realizado e o saldo projetado com o que ainda está a confirmar. Cartões aparecem com a dívida em aberto."
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            Nova conta
          </Button>
        }
      />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorNote error={q.error} />
      ) : !q.data?.data.length ? (
        <Empty title="Nenhuma conta ainda" action={<Button variant="primary" onClick={() => setEditing('new')}>Nova conta</Button>}>
          Comece pela conta corrente onde cai o salário.
        </Empty>
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Conta</Th>
                <Th className="hidden sm:table-cell">Tipo</Th>
                <Th right>Saldo</Th>
                <Th right className="hidden md:table-cell">A confirmar</Th>
                <Th right>Projetado</Th>
              </tr>
            </thead>
            <tbody>
              {q.data.data.map((a) => (
                <tr key={a.id} className="hover:bg-paper">
                  <Td>
                    <button type="button" className="flex items-center gap-2 text-left font-medium hover:underline" onClick={() => setEditing(a)}>
                      <span className="inline-block size-2.5 rounded-full" style={{ background: a.color ?? 'var(--rule-strong)' }} />
                      {a.name}
                    </button>
                    {!a.isActive && <Badge>Arquivada</Badge>}
                  </Td>
                  <Td className="hidden text-ink-2 sm:table-cell">{ACCOUNT_TYPE_LABEL[a.type]}</Td>
                  <Td right>
                    <Money value={a.balance} />
                  </Td>
                  <Td right className="hidden md:table-cell">
                    <Money value={a.pendingAmount} tone="muted" />
                  </Td>
                  <Td right>
                    <Money value={a.projectedBalance} />
                  </Td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {q.data.totals.byCurrency.map((t) => (
                <tr key={t.currency} className="font-semibold">
                  <Td>Total {t.currency}</Td>
                  <Td className="hidden sm:table-cell" />
                  <Td right>
                    <span className="num">{formatBRL(t.balance)}</span>
                  </Td>
                  <Td className="hidden md:table-cell" />
                  <Td right>
                    <span className="num">{formatBRL(t.projectedBalance)}</span>
                  </Td>
                </tr>
              ))}
            </tfoot>
          </Table>
          <label className="mt-3 flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="size-4 accent-[var(--accent)]" />
            Mostrar contas arquivadas
          </label>
        </>
      )}
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Nova conta' : 'Editar conta'}>
        {editing && <AccountForm account={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

function AccountForm({ account, onDone }: { account: Account | null; onDone: () => void }) {
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState(account?.type ?? 'checking');
  const [initial, setInitial] = useState(moneyToInput(account?.initialBalance ?? ''));
  const [color, setColor] = useState(account?.color ?? '#2A78D6');
  const save = useAction((body: object) => (account ? patch(`/accounts/${account.id}`, body) : post('/accounts', body)), onDone);
  const archive = useAction(() => del(`/accounts/${account!.id}`), onDone);
  const restore = useAction(() => patch(`/accounts/${account!.id}`, { isActive: true }), onDone);
  const isCard = account?.type === 'credit_card';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const initialBalance = parseMoneyInput(initial || '0') ?? '0.00';
    save.mutate(account ? { name, color, ...(isCard ? {} : { initialBalance }) } : { name, type, initialBalance, color });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Nome">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />}</Field>
      {!account && (
        <Field label="Tipo" hint="Cartões de crédito são cadastrados em Cartões.">
          {(id) => (
            <Select id={id} value={type} onChange={(e) => setType(e.target.value as Account['type'])}>
              {(['checking', 'savings', 'wallet', 'investment', 'other'] as const).map((t) => (
                <option key={t} value={t}>
                  {ACCOUNT_TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        {!isCard && (
          <Field label="Saldo inicial" hint="Saldo da conta no dia em que você começou a usar o sistema. Pode ser negativo.">
            {(id) => <MoneyInput id={id} value={initial} onChange={(e) => setInitial(e.target.value)} />}
          </Field>
        )}
        <Field label="Cor">{(id) => <input id={id} type="color" value={color} onChange={(e) => setColor(e.target.value.toUpperCase())} className="h-9 w-16 rounded-md border border-rule-strong bg-surface p-1" />}</Field>
      </div>
      <FormActions error={save.error ?? archive.error}>
        {account && account.isActive && !isCard && (
          <Button variant="danger" className="mr-auto" onClick={() => archive.mutate(undefined)}>
            Arquivar
          </Button>
        )}
        {account && !account.isActive && (
          <Button className="mr-auto" onClick={() => restore.mutate(undefined)}>
            Reativar
          </Button>
        )}
        <Button onClick={onDone}>Cancelar</Button>
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {account ? 'Salvar' : 'Criar conta'}
        </Button>
      </FormActions>
    </form>
  );
}
