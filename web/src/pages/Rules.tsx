import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { del, get, patch, post } from '../api/client';
import { useAction } from '../api/hooks';
import type { CategoryRule, List } from '../api/types';
import { CategorySelect } from '../components/selects';
import { Button, Empty, ErrorNote, Field, FormActions, Input, Loading, PageHeader, SectionTitle, Select, Table, Td, Th } from '../components/ui';

const MATCH: Record<CategoryRule['matchType'], string> = {
  contains: 'contém',
  starts_with: 'começa com',
  ends_with: 'termina com',
  exact: 'é igual a',
  regex: 'expressão regular',
};

export function RulesPage() {
  const rules = useQuery({ queryKey: ['rules'], queryFn: () => get<List<CategoryRule>>('/category-rules'), select: (r) => r.data });
  const toggle = useAction((r: CategoryRule) => patch(`/category-rules/${r.id}`, { isActive: !r.isActive }));
  const remove = useAction((id: string) => del(`/category-rules/${id}`));
  const apply = useAction(() => post<{ scanned: number; categorized: number }>('/category-rules/apply'));

  return (
    <div className="space-y-10">
      <PageHeader
        title="Regras de categoria"
        description="De/para determinístico: quando a descrição bate com a regra, a categoria é aplicada — na importação e nos lançamentos sem categoria. A primeira regra que casar vence."
        actions={
          <Button onClick={() => apply.mutate(undefined)} disabled={apply.isPending}>
            Aplicar aos lançamentos sem categoria
          </Button>
        }
      />
      {apply.data && (
        <p className="rounded-md bg-pos-soft px-3 py-2 text-sm text-pos">
          {apply.data.categorized} de {apply.data.scanned} lançamentos sem categoria foram categorizados.
        </p>
      )}
      <div className="grid gap-10 lg:grid-cols-[1.5fr_1fr]">
        <section>
          {rules.isLoading ? (
            <Loading />
          ) : !rules.data?.length ? (
            <Empty title="Nenhuma regra">Crie regras como “contém IFOOD → Delivery”. Ao importar extratos, suas correções também viram regras.</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Quando a descrição…</Th>
                  <Th>Categoria</Th>
                  <Th right className="hidden sm:table-cell">Prioridade</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rules.data.map((r) => (
                  <tr key={r.id} className={r.isActive ? undefined : 'text-ink-3'}>
                    <Td>
                      {MATCH[r.matchType]} <code className="rounded bg-sunken px-1.5 py-0.5 text-[13px]">{r.pattern}</code>
                    </Td>
                    <Td>{r.categoryName}</Td>
                    <Td right className="num hidden sm:table-cell">
                      {r.priority}
                    </Td>
                    <Td right className="whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => toggle.mutate(r)}>
                        {r.isActive ? 'Pausar' : 'Ativar'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => remove.mutate(r.id)}>
                        Excluir
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <ErrorNote error={toggle.error ?? remove.error ?? apply.error} />
        </section>
        <div className="space-y-10">
          <section>
            <SectionTitle>Nova regra</SectionTitle>
            <RuleForm />
          </section>
          <section>
            <SectionTitle>Testar uma descrição</SectionTitle>
            <RuleTester />
          </section>
        </div>
      </div>
    </div>
  );
}

function RuleForm() {
  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [matchType, setMatchType] = useState<CategoryRule['matchType']>('contains');
  const [pattern, setPattern] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [priority, setPriority] = useState('100');
  const save = useAction(
    (body: object) => post('/category-rules', body),
    () => setPattern(''),
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ matchType, pattern, categoryId, priority: Number(priority) });
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-[auto_1fr] gap-2">
        <Field label="Descrição">
          {(id) => (
            <Select id={id} value={matchType} onChange={(e) => setMatchType(e.target.value as CategoryRule['matchType'])}>
              {Object.entries(MATCH).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Texto" hint="Sem diferença de maiúsculas e acentos.">
          {(id) => <Input id={id} value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="IFOOD" required />}
        </Field>
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Field label="Categoria">
          {(id) => (
            <div className="space-y-2">
              <Select value={type} onChange={(e) => setType(e.target.value as 'expense' | 'income')} aria-label="Tipo de categoria">
                <option value="expense">Despesa</option>
                <option value="income">Receita</option>
              </Select>
              <CategorySelect id={id} type={type} value={categoryId} onChange={setCategoryId} />
            </div>
          )}
        </Field>
        <Field label="Prioridade" hint="Menor vence">
          {(id) => <Input id={id} type="number" min={0} value={priority} onChange={(e) => setPriority(e.target.value)} className="w-24" />}
        </Field>
      </div>
      <FormActions error={save.error}>
        <Button type="submit" variant="primary" disabled={!categoryId || save.isPending}>
          Criar regra
        </Button>
      </FormActions>
    </form>
  );
}

function RuleTester() {
  const [text, setText] = useState('');
  const test = useAction((description: string) => post<{ matched: CategoryRule | null; suggestedPattern: string }>('/category-rules/test', { description }));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (text) test.mutate(text);
      }}
      className="space-y-3"
    >
      <div className="flex gap-2">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="ex.: PAG*IFOOD 12/11" aria-label="Descrição para testar" />
        <Button type="submit">Testar</Button>
      </div>
      {test.data && (
        <p className="text-sm">
          {test.data.matched ? (
            <>
              Cai em <strong>{test.data.matched.categoryName}</strong> pela regra “{MATCH[test.data.matched.matchType]} {test.data.matched.pattern}”.
            </>
          ) : (
            <>
              Nenhuma regra casa. Sugestão de padrão: <code className="rounded bg-sunken px-1.5 py-0.5">{test.data.suggestedPattern}</code>
            </>
          )}
        </p>
      )}
    </form>
  );
}
