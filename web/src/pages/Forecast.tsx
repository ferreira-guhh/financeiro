import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { get, qs } from '../api/client';
import type { Forecast } from '../api/types';
import { MoneyAreaChart } from '../components/charts';
import { Badge, Checkbox, ErrorNote, Loading, Money, PageHeader, SectionTitle, Segmented, Stat, Table, Td, Th } from '../components/ui';
import { formatDate, formatDayMonth, formatMonthLong, formatMonthTitle, isNegative, toNumber } from '../lib/format';

const KIND: Record<string, string> = { pending: 'A confirmar', recurring: 'Conta fixa', installment: 'Parcela', invoice: 'Fatura' };

export function ForecastPage() {
  const [months, setMonths] = useState<'3' | '6' | '12'>('6');
  const [withVariable, setWithVariable] = useState(true);
  const q = useQuery({
    queryKey: ['forecast', months, withVariable],
    queryFn: () => get<Forecast>(`/forecast${qs({ months, includeVariableAverage: withVariable })}`),
    placeholderData: (prev) => prev,
  });
  const f = q.data;

  return (
    <div className="space-y-10">
      <PageHeader title="Previsão de caixa" description="Saldo das contas de movimento dia a dia, somando contas fixas, parcelas, pendências e faturas de cartão no vencimento." />
      <div className="flex flex-wrap items-center gap-6">
        <Segmented
          value={months}
          onChange={setMonths}
          options={[
            { value: '3', label: '3 meses' },
            { value: '6', label: '6 meses' },
            { value: '12', label: '12 meses' },
          ]}
        />
        <Checkbox label="Incluir gasto variável médio" hint="Mercado, delivery, transporte: média dos últimos 3 meses distribuída por dia." checked={withVariable} onChange={setWithVariable} />
      </div>

      {q.isLoading ? (
        <Loading />
      ) : !f ? (
        <ErrorNote error={q.error} />
      ) : (
        <>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Saldo hoje" value={<Money value={f.startBalance} />} />
            <Stat label={`Saldo em ${formatDate(f.endDate)}`} value={<Money value={f.summary.endBalance} />} />
            <Stat label="Menor saldo no período" value={<Money value={f.summary.lowestBalance} />} hint={`em ${formatDate(f.summary.lowestDate)}`} />
            <Stat
              label="Fica negativo?"
              value={f.summary.firstNegativeDate ? <span className="text-neg">Sim</span> : 'Não'}
              hint={f.summary.firstNegativeDate ? `a partir de ${formatDate(f.summary.firstNegativeDate)}` : 'em nenhum dia do período'}
            />
          </div>

          <section>
            <SectionTitle>Saldo previsto</SectionTitle>
            <MoneyAreaChart
              data={f.days.map((d) => ({ date: d.date, balance: toNumber(d.balance) }))}
              xKey="date"
              xFormatter={formatDayMonth}
              tooltipLabel={formatDate}
              series={[{ key: 'balance', label: 'Saldo previsto', slot: 1 }]}
              zeroLine={f.days.some((d) => isNegative(d.balance))}
              height={280}
            />
          </section>

          <div className="grid gap-10 lg:grid-cols-[1fr_1fr]">
            <section>
              <SectionTitle>Mês a mês</SectionTitle>
              <Table>
                <thead>
                  <tr>
                    <Th>Mês</Th>
                    <Th right>Entradas</Th>
                    <Th right>Saídas</Th>
                    <Th right>Faturas</Th>
                    <Th right>Saldo final</Th>
                  </tr>
                </thead>
                <tbody>
                  {f.months.map((m) => (
                    <tr key={m.month}>
                      <Td className="whitespace-nowrap">{formatMonthTitle(m.month)}</Td>
                      <Td right>
                        <Money value={m.income} tone="plain" />
                      </Td>
                      <Td right>
                        <Money value={m.expenses} tone="plain" />
                      </Td>
                      <Td right>
                        <Money value={m.cardInvoices} tone="plain" />
                      </Td>
                      <Td right>
                        <Money value={m.endBalance} className="font-medium" />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </section>
            <section>
              <SectionTitle aside="exceto gasto variável">Próximos eventos</SectionTitle>
              <ul className="tabular max-h-[420px] divide-y divide-rule overflow-y-auto border-y border-rule">
                {f.events.slice(0, 60).map((e, i) => (
                  <li key={`${e.date}-${i}`} className="flex items-center gap-3 py-2 text-sm">
                    <span className="num w-14 shrink-0 text-ink-2">{formatDayMonth(e.date)}</span>
                    <span className="min-w-0 flex-1 truncate">{e.description}</span>
                    <Badge>{KIND[e.kind] ?? e.kind}</Badge>
                    <Money value={e.amount} sign className="w-28 text-right" />
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
