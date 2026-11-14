import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, del, get, patch, post } from '../api/client';
import { categoryLabel, useAction, useCategories } from '../api/hooks';
import type { ImportBatch, ImportRow, List } from '../api/types';
import { AccountSelect } from '../components/selects';
import { Badge, Button, Checkbox, Empty, ErrorNote, Field, FormActions, Loading, Money, PageHeader, SectionTitle, Select, Table, Td, Th } from '../components/ui';
import { formatDate } from '../lib/format';

const DETECTION: Record<ImportRow['detection'], { label: string; tone: 'neutral' | 'warn' | 'neg' | 'accent' | 'pos' }> = {
  new: { label: 'Nova', tone: 'pos' },
  duplicate: { label: 'Já existe', tone: 'neg' },
  possible_duplicate: { label: 'Talvez duplicada', tone: 'warn' },
  reconcile: { label: 'Concilia com pendente', tone: 'accent' },
};

const SOURCE: Record<string, string> = { rule: 'regra', history: 'histórico' };

export function ImportPage() {
  const [batchId, setBatchId] = useState<string | null>(null);
  const history = useQuery({ queryKey: ['imports'], queryFn: () => get<List<ImportBatch>>('/imports'), select: (r) => r.data });

  return (
    <div className="space-y-10">
      <PageHeader
        title="Importar extrato"
        description="Envie o arquivo do banco (OFX, CSV ou Excel). Você revisa cada linha antes de qualquer coisa entrar no livro-caixa."
      />
      {batchId ? <Review batchId={batchId} onClose={() => setBatchId(null)} /> : <Upload onUploaded={setBatchId} />}

      {!batchId && history.data && history.data.length > 0 && (
        <section>
          <SectionTitle>Importações anteriores</SectionTitle>
          <Table>
            <thead>
              <tr>
                <Th>Arquivo</Th>
                <Th className="hidden sm:table-cell">Conta</Th>
                <Th>Situação</Th>
                <Th right>Linhas</Th>
              </tr>
            </thead>
            <tbody>
              {history.data.map((b) => (
                <tr key={b.id} className="hover:bg-paper">
                  <Td>
                    <button type="button" className="text-left hover:underline" onClick={() => setBatchId(b.id)}>
                      {b.fileName ?? b.source.toUpperCase()}
                    </button>
                    <div className="text-[12px] text-ink-3">{formatDate(b.createdAt.slice(0, 10))}</div>
                  </Td>
                  <Td className="hidden text-ink-2 sm:table-cell">{b.accountName}</Td>
                  <Td>
                    {b.status === 'preview' ? <Badge tone="warn">Aguardando revisão</Badge> : b.status === 'confirmed' ? <Badge tone="pos">Importado</Badge> : <Badge>Descartado</Badge>}
                  </Td>
                  <Td right className="num text-ink-2">
                    {b.status === 'confirmed' ? `${b.importedCount} novas · ${b.reconciledCount} conciliadas · ${b.skippedCount} ignoradas` : b.rowCount}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      )}
    </div>
  );
}

function Upload({ onUploaded }: { onUploaded: (id: string) => void }) {
  const [accountId, setAccountId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [invertSign, setInvertSign] = useState<'' | 'true' | 'false'>('');
  const [decimal, setDecimal] = useState('');
  const [dateFormat, setDateFormat] = useState('');
  const upload = useAction(
    (form: FormData) => api<ImportBatch>('POST', '/imports', form),
    (b) => onUploaded(b.id),
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    const form = new FormData();
    form.append('accountId', accountId);
    const options: Record<string, unknown> = {};
    if (invertSign) options.invertSign = invertSign === 'true';
    if (decimal) options.decimalSeparator = decimal;
    if (dateFormat) options.dateFormat = dateFormat;
    if (Object.keys(options).length) form.append('options', JSON.stringify(options));
    form.append('file', file);
    upload.mutate(form);
  };

  return (
    <form onSubmit={submit} className="max-w-xl space-y-4">
      <Field label="Conta ou cartão do extrato">{(id) => <AccountSelect id={id} value={accountId} onChange={setAccountId} />}</Field>
      <Field label="Arquivo" hint="OFX/QFX, CSV (vírgula ou ponto-e-vírgula) ou Excel (.xlsx). Até 5 MB.">
        {(id) => (
          <input
            id={id}
            type="file"
            accept=".ofx,.qfx,.csv,.txt,.xlsx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm file:mr-3 file:h-9 file:rounded-md file:border file:border-rule-strong file:bg-surface file:px-3 file:text-sm file:font-medium hover:file:bg-sunken"
            required
          />
        )}
      </Field>
      <button type="button" className="text-[13px] text-ink-2 hover:text-ink hover:underline" onClick={() => setAdvanced(!advanced)}>
        {advanced ? 'Ocultar opções de leitura' : 'Opções de leitura (CSV/Excel)'}
      </button>
      {advanced && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Sinal dos valores" hint="Faturas listam compras como positivas">
            {(id) => (
              <Select id={id} value={invertSign} onChange={(e) => setInvertSign(e.target.value as '' | 'true' | 'false')}>
                <option value="">Automático</option>
                <option value="false">Como está</option>
                <option value="true">Inverter</option>
              </Select>
            )}
          </Field>
          <Field label="Separador decimal">
            {(id) => (
              <Select id={id} value={decimal} onChange={(e) => setDecimal(e.target.value)}>
                <option value="">Automático</option>
                <option value=",">Vírgula (1.234,56)</option>
                <option value=".">Ponto (1,234.56)</option>
              </Select>
            )}
          </Field>
          <Field label="Formato de data">
            {(id) => (
              <Select id={id} value={dateFormat} onChange={(e) => setDateFormat(e.target.value)}>
                <option value="">DD/MM/AAAA</option>
                <option value="YYYY-MM-DD">AAAA-MM-DD</option>
                <option value="MM/DD/YYYY">MM/DD/AAAA</option>
              </Select>
            )}
          </Field>
        </div>
      )}
      <FormActions error={upload.error}>
        <Button type="submit" variant="primary" disabled={!accountId || !file || upload.isPending}>
          {upload.isPending ? 'Lendo arquivo…' : 'Ler arquivo'}
        </Button>
      </FormActions>
    </form>
  );
}

function Review({ batchId, onClose }: { batchId: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['import', batchId], queryFn: () => get<ImportBatch>(`/imports/${batchId}`) });
  const { data: categories } = useCategories();
  const label = categoryLabel(categories);
  const [learn, setLearn] = useState(true);
  const updateRow = useAction(({ id, body }: { id: string; body: object }) => patch(`/imports/${batchId}/rows/${id}`, body));
  const confirm = useAction(() => post<{ imported: number; reconciled: number; skipped: number; rulesCreated: number }>(`/imports/${batchId}/confirm`, { learnRules: learn }));
  const discard = useAction(() => del(`/imports/${batchId}`), onClose);

  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorNote error={q.error} />;
  const b = q.data;
  const editable = b.status === 'preview';
  const s = b.summary!;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-[17px] font-semibold">{b.fileName ?? 'Importação'}</h2>
          <p className="text-sm text-ink-2">
            {b.accountName} · {b.rowCount} linhas · {s.new} novas, {s.duplicate} já existentes, {s.possibleDuplicate} talvez duplicadas, {s.reconcile} conciliáveis · {s.categorized} categorizadas
          </p>
        </div>
        <Button variant="ghost" onClick={onClose}>
          Voltar
        </Button>
      </div>
      {b.warnings?.map((w) => (
        <p key={w} className="rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
          {w}
        </p>
      ))}
      {confirm.data && (
        <p className="rounded-md bg-pos-soft px-3 py-2 text-sm text-pos">
          Importado: {confirm.data.imported} novas, {confirm.data.reconciled} conciliadas, {confirm.data.skipped} ignoradas
          {confirm.data.rulesCreated > 0 && `, ${confirm.data.rulesCreated} regra(s) aprendida(s)`}.
        </p>
      )}

      {!b.rows?.length ? (
        <Empty title="Sem linhas" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Data</Th>
              <Th>Descrição</Th>
              <Th right>Valor</Th>
              <Th>Detecção</Th>
              <Th>Categoria</Th>
              <Th>Ação</Th>
            </tr>
          </thead>
          <tbody>
            {b.rows.map((r) => {
              const type = r.amount.startsWith('-') ? 'expense' : 'income';
              const options = (categories ?? []).filter((c) => c.type === type);
              return (
                <tr key={r.id} className={r.action === 'skip' ? 'text-ink-3' : undefined}>
                  <Td className="num whitespace-nowrap">{formatDate(r.date)}</Td>
                  <Td className="max-w-72">
                    <span className="block truncate" title={r.description}>
                      {r.description}
                    </span>
                  </Td>
                  <Td right>
                    <Money value={r.amount} sign tone={r.action === 'skip' ? 'muted' : 'auto'} />
                  </Td>
                  <Td>
                    <Badge tone={DETECTION[r.detection].tone}>{DETECTION[r.detection].label}</Badge>
                  </Td>
                  <Td className="min-w-48">
                    {editable && r.action !== 'skip' ? (
                      <Select value={r.categoryId ?? ''} onChange={(e) => updateRow.mutate({ id: r.id, body: { categoryId: e.target.value || null } })} aria-label="Categoria" className="h-8">
                        <option value="">Sem categoria</option>
                        {options.map((c) => (
                          <option key={c.id} value={c.id}>
                            {label(c.id)}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <span className="text-ink-2">{label(r.categoryId) ?? '—'}</span>
                    )}
                    {r.suggestionSource !== 'none' && r.categoryId === r.suggestedCategoryId && <span className="mt-0.5 block text-[12px] text-ink-3">sugerida por {SOURCE[r.suggestionSource]}</span>}
                  </Td>
                  <Td>
                    {editable ? (
                      <Select value={r.action} onChange={(e) => updateRow.mutate({ id: r.id, body: { action: e.target.value } })} aria-label="Ação" className="h-8">
                        <option value="import">Importar</option>
                        <option value="skip">Ignorar</option>
                        {r.detection === 'reconcile' && <option value="reconcile">Conciliar</option>}
                      </Select>
                    ) : (
                      <span className="text-ink-2">{{ import: 'Importar', skip: 'Ignorar', reconcile: 'Conciliar' }[r.action]}</span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <ErrorNote error={updateRow.error} />

      {editable && (
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-rule pt-4">
          <Checkbox label="Aprender com minhas correções" hint="Cria regras para as categorias que você escolheu e que não vieram sugeridas." checked={learn} onChange={setLearn} />
          <FormActions error={confirm.error ?? discard.error}>
            <Button variant="danger" onClick={() => discard.mutate(undefined)}>
              Descartar
            </Button>
            <Button variant="primary" onClick={() => confirm.mutate(undefined)} disabled={confirm.isPending}>
              Confirmar: {s.toImport} novas{s.toReconcile ? `, ${s.toReconcile} conciliações` : ''}
            </Button>
          </FormActions>
        </div>
      )}
    </div>
  );
}
