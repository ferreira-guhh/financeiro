import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { get, post, put } from '../api/client';
import { useAction, useCategories } from '../api/hooks';
import type { Settings } from '../api/types';
import { Button, Checkbox, ErrorNote, Field, FormActions, Input, Loading, MoneyInput, PageHeader, SectionTitle, Select, Table, Td, Th } from '../components/ui';
import { formatDate, moneyToInput, parseMoneyInput } from '../lib/format';

export function SettingsPage() {
  return (
    <div className="space-y-12">
      <PageHeader title="Configurações" />
      <div className="grid gap-12 lg:grid-cols-2">
        <SafeToSpendSettings />
        <Categories />
      </div>
      <Audit />
    </div>
  );
}

function SafeToSpendSettings() {
  const q = useQuery({ queryKey: ['settings'], queryFn: () => get<Settings>('/settings') });
  const [form, setForm] = useState<Settings | null>(null);
  useEffect(() => {
    if (q.data) setForm(q.data);
  }, [q.data]);
  const save = useAction((body: object) => put('/settings', body));
  if (!form) return <Loading />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({
      incomeBasis: form.incomeBasis,
      fixedMonthlyIncome: form.incomeBasis === 'fixed' ? parseMoneyInput(form.fixedMonthlyIncome ?? '') : null,
      monthlyReserveAmount: parseMoneyInput(form.monthlyReserveAmount) ?? '0.00',
      includeGoalContributions: form.includeGoalContributions,
      safetyMarginPercent: form.safetyMarginPercent.replace(',', '.') || '0',
    });
  };

  return (
    <section>
      <SectionTitle>Gasto seguro</SectionTitle>
      <p className="mb-4 text-sm text-ink-2">Receita − contas fixas − parcelas − agendadas − reserva − metas − folga = quanto você pode gastar no mês sem comprometer o resto.</p>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Receita considerada">
          {(id) => (
            <Select id={id} value={form.incomeBasis} onChange={(e) => setForm({ ...form, incomeBasis: e.target.value as Settings['incomeBasis'] })}>
              <option value="recurring">Receitas fixas cadastradas (salário etc.)</option>
              <option value="average_3m">Média das receitas dos últimos 3 meses</option>
              <option value="fixed">Um valor que eu informo</option>
            </Select>
          )}
        </Field>
        {form.incomeBasis === 'fixed' && (
          <Field label="Renda mensal">{(id) => <MoneyInput id={id} value={moneyToInput(form.fixedMonthlyIncome)} onChange={(e) => setForm({ ...form, fixedMonthlyIncome: e.target.value.replace(',', '.') })} />}</Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Reservar por mês" hint="Reserva de emergência, imprevistos">
            {(id) => <MoneyInput id={id} value={moneyToInput(form.monthlyReserveAmount)} onChange={(e) => setForm({ ...form, monthlyReserveAmount: e.target.value.replace(',', '.') })} />}
          </Field>
          <Field label="Folga de segurança (% da receita)">
            {(id) => <Input id={id} inputMode="decimal" value={form.safetyMarginPercent.replace('.', ',')} onChange={(e) => setForm({ ...form, safetyMarginPercent: e.target.value })} />}
          </Field>
        </div>
        <Checkbox label="Descontar os aportes mensais das metas ativas" checked={form.includeGoalContributions} onChange={(v) => setForm({ ...form, includeGoalContributions: v })} />
        <p className="text-[12px] text-ink-3">É uma estimativa a partir dos seus dados, não uma recomendação financeira profissional.</p>
        <FormActions error={save.error}>
          {save.isSuccess && <span className="mr-auto self-center text-sm text-pos">Salvo.</span>}
          <Button type="submit" variant="primary" disabled={save.isPending}>
            Salvar parâmetros
          </Button>
        </FormActions>
      </form>
    </section>
  );
}

function Categories() {
  const { data = [] } = useCategories();
  const [name, setName] = useState('');
  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [parentId, setParentId] = useState('');
  const [essential, setEssential] = useState(false);
  const create = useAction(
    (body: object) => post('/categories', body),
    () => setName(''),
  );
  const parents = data.filter((c) => c.type === type && !c.parentId);
  const mine = data.filter((c) => !c.isSystem);

  return (
    <section>
      <SectionTitle>Categorias</SectionTitle>
      <p className="mb-4 text-sm text-ink-2">
        As categorias padrão cobrem o essencial. Crie as suas para o que for específico. “Essencial” separa despesas essenciais de estilo de vida nos relatórios.
      </p>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({ name, type, parentId: parentId || undefined, isEssential: essential });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} required />}</Field>
          <Field label="Tipo">
            {(id) => (
              <Select
                id={id}
                value={type}
                onChange={(e) => {
                  setType(e.target.value as 'expense' | 'income');
                  setParentId('');
                }}
              >
                <option value="expense">Despesa</option>
                <option value="income">Receita</option>
              </Select>
            )}
          </Field>
        </div>
        <Field label="Dentro de" hint="Opcional: vira subcategoria">
          {(id) => (
            <Select id={id} value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">Nenhuma (categoria principal)</option>
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {type === 'expense' && <Checkbox label="Despesa essencial" checked={essential} onChange={setEssential} />}
        <FormActions error={create.error}>
          <Button type="submit" variant="primary" disabled={create.isPending}>
            Criar categoria
          </Button>
        </FormActions>
      </form>
      {mine.length > 0 && (
        <ul className="mt-6 divide-y divide-rule border-y border-rule text-sm">
          {mine.map((c) => (
            <li key={c.id} className="flex justify-between py-2">
              <span>{c.name}</span>
              <span className="text-ink-3">{c.type === 'income' ? 'Receita' : c.isEssential ? 'Despesa essencial' : 'Despesa'}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Audit() {
  const q = useQuery({
    queryKey: ['audit'],
    queryFn: () => get<{ data: { id: string; action: string; statusCode: number | null; ip: string | null; createdAt: string }[] }>('/audit-logs?limit=30'),
  });
  return (
    <section>
      <SectionTitle aside="últimas 30">Registro de operações</SectionTitle>
      <ErrorNote error={q.error} />
      {q.data && (
        <Table>
          <thead>
            <tr>
              <Th>Quando</Th>
              <Th>Operação</Th>
              <Th className="hidden sm:table-cell">IP</Th>
            </tr>
          </thead>
          <tbody>
            {q.data.data.map((a) => (
              <tr key={a.id}>
                <Td className="num whitespace-nowrap text-ink-2">
                  {formatDate(a.createdAt.slice(0, 10))} {a.createdAt.slice(11, 16)}
                </Td>
                <Td>
                  <code className="text-[13px]">{a.action.replace('/api/v1', '')}</code>
                </Td>
                <Td className="hidden text-ink-3 sm:table-cell">{a.ip}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  );
}
