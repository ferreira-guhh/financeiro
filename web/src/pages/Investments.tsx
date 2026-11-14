import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { del, get, patch, post } from '../api/client';
import { useAction } from '../api/hooks';
import type { Investment, InvestmentSummary, List } from '../api/types';
import { AccountSelect } from '../components/selects';
import { Badge, Button, Empty, ErrorNote, Field, FormActions, Input, Loading, Modal, Money, MoneyInput, PageHeader, SectionTitle, Select, Stat, Table, Td, Th } from '../components/ui';
import { formatBRL, formatDate, formatPercent, isNegative, moneyToInput, parseMoneyInput, todayISO, toNumber } from '../lib/format';

const TYPES: Record<string, string> = {
  savings: 'Poupança',
  cdb: 'CDB',
  lci_lca: 'LCI/LCA',
  treasury: 'Tesouro Direto',
  fund: 'Fundo',
  stocks: 'Ações',
  reit: 'FII',
  crypto: 'Cripto',
  pension: 'Previdência',
  other: 'Outro',
};

const LIQUIDITY: Record<string, string> = {
  daily: 'Diária',
  up_to_30_days: 'Até 30 dias',
  up_to_1_year: 'Até 1 ano',
  over_1_year: 'Mais de 1 ano',
  at_maturity: 'No vencimento',
};

export function InvestmentsPage() {
  const list = useQuery({ queryKey: ['investments'], queryFn: () => get<List<Investment>>('/investments'), select: (r) => r.data });
  const summary = useQuery({ queryKey: ['investments-summary'], queryFn: () => get<InvestmentSummary>('/investments/summary') });
  const [editing, setEditing] = useState<Investment | 'new' | null>(null);
  const s = summary.data;
  const totalCurrent = toNumber(s?.totalCurrent);

  return (
    <div className="space-y-10">
      <PageHeader
        title="Investimentos"
        description="Registro das suas aplicações por tipo, liquidez e prazo. O sistema organiza, não recomenda."
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            Registrar aplicação
          </Button>
        }
      />

      {s && toNumber(s.totalInvested) > 0 && (
        <div className="grid gap-10 lg:grid-cols-3">
          <div className="space-y-5">
            <Stat label="Valor atual" value={<Money value={s.totalCurrent} />} hint={`Aplicado: ${formatBRL(s.totalInvested)}`} />
            <Stat
              label="Resultado"
              value={<Money value={(toNumber(s.totalCurrent) - toNumber(s.totalInvested)).toFixed(2)} sign />}
              hint={formatPercent((((toNumber(s.totalCurrent) - toNumber(s.totalInvested)) / Math.max(toNumber(s.totalInvested), 1)) * 100).toFixed(2))}
            />
          </div>
          <section>
            <SectionTitle>Por liquidez</SectionTitle>
            <Breakdown rows={s.byLiquidity.map((b) => ({ label: LIQUIDITY[b.bucket] ?? b.bucket, value: b.current }))} total={totalCurrent} />
          </section>
          <section>
            <SectionTitle>Por tipo</SectionTitle>
            <Breakdown rows={s.byType.map((b) => ({ label: TYPES[b.type] ?? b.type, value: b.current }))} total={totalCurrent} />
          </section>
        </div>
      )}

      {s && s.maturingNext90Days.length > 0 && (
        <p className="rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
          Vencendo nos próximos 90 dias: {s.maturingNext90Days.map((m) => `${m.name} (${formatDate(m.maturityDate)})`).join(', ')}.
        </p>
      )}

      {list.isLoading ? (
        <Loading />
      ) : list.error ? (
        <ErrorNote error={list.error} />
      ) : !list.data?.length ? (
        <Empty title="Nenhuma aplicação registrada" action={<Button variant="primary" onClick={() => setEditing('new')}>Registrar aplicação</Button>}>
          Registre CDBs, Tesouro, fundos e ações para enxergar liquidez e prazos.
        </Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Aplicação</Th>
              <Th className="hidden md:table-cell">Rentabilidade</Th>
              <Th className="hidden sm:table-cell">Liquidez</Th>
              <Th right className="hidden md:table-cell">Aplicado</Th>
              <Th right>Atual</Th>
            </tr>
          </thead>
          <tbody>
            {list.data.map((i) => (
              <tr key={i.id} className="hover:bg-paper">
                <Td>
                  <button type="button" onClick={() => setEditing(i)} className="text-left font-medium hover:underline">
                    {i.name}
                  </button>
                  <div className="text-[12px] text-ink-3">
                    {TYPES[i.type]}
                    {i.objective && ` · ${i.objective}`}
                  </div>
                </Td>
                <Td className="hidden text-ink-2 md:table-cell">{i.rateDescription ?? '—'}</Td>
                <Td className="hidden sm:table-cell">
                  <span className="text-ink-2">{LIQUIDITY[i.liquidityBucket]}</span>
                  {i.maturityDate && <div className="text-[12px] text-ink-3">vence {formatDate(i.maturityDate)}</div>}
                </Td>
                <Td right className="hidden md:table-cell">
                  <Money value={i.investedAmount} tone="plain" />
                </Td>
                <Td right>
                  <Money value={i.currentAmount ?? i.investedAmount} tone="plain" />
                  {i.gainPercent && <div className={`num text-[12px] ${isNegative(i.gain) ? 'text-neg' : 'text-pos'}`}>{formatPercent(i.gainPercent)}</div>}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Registrar aplicação' : 'Editar aplicação'}>
        {editing && <InvestmentForm inv={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

function Breakdown({ rows, total }: { rows: { label: string; value: string }[]; total: number }) {
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="mb-1 flex justify-between text-sm">
            <span>{r.label}</span>
            <span className="num text-ink-2">
              {formatBRL(r.value)} <span className="text-ink-3">· {((toNumber(r.value) / Math.max(total, 1)) * 100).toFixed(0)}%</span>
            </span>
          </div>
          <div className="h-2 rounded-full bg-sunken">
            <div className="h-2 rounded-full" style={{ width: `${(toNumber(r.value) / Math.max(total, 1)) * 100}%`, background: 'var(--series-1)' }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function InvestmentForm({ inv, onDone }: { inv: Investment | null; onDone: () => void }) {
  const [name, setName] = useState(inv?.name ?? '');
  const [type, setType] = useState(inv?.type ?? 'cdb');
  const [invested, setInvested] = useState(moneyToInput(inv?.investedAmount));
  const [current, setCurrent] = useState(moneyToInput(inv?.currentAmount));
  const [investedAt, setInvestedAt] = useState(inv?.investedAt ?? todayISO());
  const [rateDescription, setRateDescription] = useState(inv?.rateDescription ?? '');
  const [liquidity, setLiquidity] = useState(inv ? (inv.liquidityDays === null ? '' : String(inv.liquidityDays)) : '0');
  const [maturityDate, setMaturity] = useState(inv?.maturityDate ?? '');
  const [objective, setObjective] = useState(inv?.objective ?? '');
  const [accountId, setAccountId] = useState(inv?.accountId ?? '');
  const save = useAction((body: object) => (inv ? patch(`/investments/${inv.id}`, body) : post('/investments', body)), onDone);
  const redeem = useAction(() => patch(`/investments/${inv!.id}`, { redeemedAt: todayISO() }), onDone);
  const remove = useAction(() => del(`/investments/${inv!.id}`), onDone);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const common = {
      name,
      currentAmount: current ? parseMoneyInput(current) : inv ? null : undefined,
      rateDescription: rateDescription || (inv ? null : undefined),
      liquidityDays: liquidity === '' ? (inv ? null : undefined) : Number(liquidity),
      maturityDate: maturityDate || (inv ? null : undefined),
      objective: objective || (inv ? null : undefined),
    };
    save.mutate(inv ? common : { ...common, type, investedAmount: parseMoneyInput(invested), investedAt, accountId: accountId || undefined });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} required />}</Field>
        {!inv && (
          <Field label="Tipo">
            {(id) => (
              <Select id={id} value={type} onChange={(e) => setType(e.target.value)}>
                {Object.entries(TYPES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {!inv && <Field label="Valor aplicado">{(id) => <MoneyInput id={id} value={invested} onChange={(e) => setInvested(e.target.value)} required />}</Field>}
        {!inv && <Field label="Data da aplicação">{(id) => <Input id={id} type="date" value={investedAt} onChange={(e) => setInvestedAt(e.target.value)} required />}</Field>}
        <Field label="Valor atual" hint="Conforme o extrato da corretora">
          {(id) => <MoneyInput id={id} value={current} onChange={(e) => setCurrent(e.target.value)} />}
        </Field>
        <Field label="Rentabilidade informada">{(id) => <Input id={id} value={rateDescription} onChange={(e) => setRateDescription(e.target.value)} placeholder="ex.: 110% do CDI" />}</Field>
        <Field label="Liquidez (dias para resgate)" hint="0 = diária · vazio = só no vencimento">
          {(id) => <Input id={id} type="number" min={0} value={liquidity} onChange={(e) => setLiquidity(e.target.value)} />}
        </Field>
        <Field label="Vencimento">{(id) => <Input id={id} type="date" value={maturityDate} onChange={(e) => setMaturity(e.target.value)} />}</Field>
      </div>
      <Field label="Objetivo">{(id) => <Input id={id} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="ex.: aposentadoria" />}</Field>
      {!inv && (
        <Field label="Conta de investimento" hint="Se a aplicação já está no saldo de uma conta, vincule para não contar duas vezes no patrimônio.">
          {(id) => <AccountSelect id={id} value={accountId} onChange={setAccountId} types={['investment']} allowEmpty emptyLabel="Nenhuma" />}
        </Field>
      )}
      {inv?.status === 'redeemed' && <Badge>Resgatado</Badge>}
      <FormActions error={save.error ?? redeem.error ?? remove.error}>
        {inv && inv.status === 'active' && (
          <Button className="mr-auto" onClick={() => redeem.mutate(undefined)}>
            Marcar como resgatado
          </Button>
        )}
        {inv && (
          <Button variant="danger" onClick={() => remove.mutate(undefined)}>
            Excluir
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={save.isPending}>
          Salvar
        </Button>
      </FormActions>
    </form>
  );
}
