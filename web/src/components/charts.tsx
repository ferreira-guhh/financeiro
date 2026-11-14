/**
 * Gráficos. Regras aplicadas (skill de dataviz):
 * - cores da paleta validada (azul/laranja/aqua), em ordem fixa; nunca por posição;
 * - linhas de 2px, barras finas com topo arredondado (4px) e 2px de respiro;
 * - grade e eixos recessivos; legenda sempre que há ≥ 2 séries; tooltip em todos;
 * - um único eixo y por gráfico; tabela alternativa disponível onde importa.
 */
import { useEffect, useState, type ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import { formatBRL, formatCompact, formatPercent } from '../lib/format';
import { cx } from './ui';

const TOKENS = ['--series-1', '--series-2', '--series-3', '--series-muted', '--grid', '--ink-3', '--rule-strong', '--surface', '--neg'] as const;
type Theme = Record<(typeof TOKENS)[number], string>;

function readTheme(): Theme {
  const style = getComputedStyle(document.documentElement);
  return Object.fromEntries(TOKENS.map((t) => [t, style.getPropertyValue(t).trim()])) as Theme;
}

/** Lê os tokens CSS e reage à troca de tema claro/escuro. */
export function useChartTheme(): Theme {
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setTheme(readTheme());
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return theme;
}

export interface SeriesDef {
  key: string;
  label: string;
  /** Slot da paleta (1, 2, 3) ou 'muted' para referência. */
  slot: 1 | 2 | 3 | 'muted';
  dashed?: boolean;
}

const slotVar = (slot: SeriesDef['slot']) => (slot === 'muted' ? '--series-muted' : (`--series-${slot}` as const));

function MoneyTooltip({ active, payload, label, formatLabel, series }: TooltipContentProps<number, string> & { formatLabel?: (l: string) => string; series: SeriesDef[] }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-44 rounded-md border border-rule bg-surface px-3 py-2 text-[13px] shadow-[0_8px_24px_-12px_rgb(0_0_0/0.3)]">
      <div className="mb-1 font-medium">{formatLabel ? formatLabel(String(label)) : label}</div>
      {payload.map((p) => {
        const def = series.find((s) => s.key === p.dataKey);
        return (
          <div key={String(p.dataKey)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-ink-2">
              <span className="inline-block h-0.5 w-3 rounded" style={{ background: p.color }} />
              {def?.label ?? p.name}
            </span>
            <span className="num font-medium">{formatBRL(Number(p.value).toFixed(2))}</span>
          </div>
        );
      })}
    </div>
  );
}

function LegendRow({ series, theme }: { series: SeriesDef[]; theme: Theme }) {
  return (
    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-2">
      {series.map((s) => (
        <span key={s.key} className="flex items-center gap-1.5">
          <span
            className="inline-block h-[3px] w-4 rounded"
            style={{ background: s.dashed ? `repeating-linear-gradient(90deg, ${theme[slotVar(s.slot)]} 0 4px, transparent 4px 7px)` : theme[slotVar(s.slot)] }}
          />
          {s.label}
        </span>
      ))}
    </div>
  );
}

interface ChartProps {
  data: object[];
  xKey: string;
  series: SeriesDef[];
  height?: number;
  xFormatter?: (v: string) => string;
  tooltipLabel?: (v: string) => string;
  zeroLine?: boolean;
}

/** Barras agrupadas (ex.: receitas × despesas por mês). */
export function MoneyBarChart({ data, xKey, series, height = 260, xFormatter, tooltipLabel }: ChartProps) {
  const theme = useChartTheme();
  return (
    <div>
      {series.length > 1 && <LegendRow series={series} theme={theme} />}
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} barGap={2} barCategoryGap="28%" margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={theme['--grid']} />
          <XAxis dataKey={xKey} tickFormatter={xFormatter} tickLine={false} axisLine={{ stroke: theme['--rule-strong'] }} interval="preserveStartEnd" />
          <YAxis tickFormatter={formatCompact} tickLine={false} axisLine={false} width={52} />
          <Tooltip
            cursor={{ fill: theme['--grid'], opacity: 0.6 }}
            content={(p) => <MoneyTooltip {...(p as TooltipContentProps<number, string>)} series={series} formatLabel={tooltipLabel ?? xFormatter} />}
          />
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={theme[slotVar(s.slot)]} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
          ))}
          <Legend content={() => null} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Linhas (evolução de saldo, cenários). */
export function MoneyLineChart({ data, xKey, series, height = 260, xFormatter, tooltipLabel, zeroLine }: ChartProps) {
  const theme = useChartTheme();
  return (
    <div>
      {series.length > 1 && <LegendRow series={series} theme={theme} />}
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={theme['--grid']} />
          <XAxis dataKey={xKey} tickFormatter={xFormatter} tickLine={false} axisLine={{ stroke: theme['--rule-strong'] }} minTickGap={24} />
          <YAxis tickFormatter={formatCompact} tickLine={false} axisLine={false} width={56} />
          {zeroLine && <ReferenceLine y={0} stroke={theme['--neg']} strokeDasharray="3 3" />}
          <Tooltip
            cursor={{ stroke: theme['--rule-strong'], strokeWidth: 1 }}
            content={(p) => <MoneyTooltip {...(p as TooltipContentProps<number, string>)} series={series} formatLabel={tooltipLabel ?? xFormatter} />}
          />
          {series.map((s) => (
            <Line
              key={s.key}
              dataKey={s.key}
              name={s.label}
              stroke={theme[slotVar(s.slot)]}
              strokeWidth={2}
              strokeDasharray={s.dashed ? '5 4' : undefined}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: theme['--surface'] }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Uma série com área suave (saldo diário previsto). */
export function MoneyAreaChart({ data, xKey, series, height = 240, xFormatter, tooltipLabel, zeroLine }: ChartProps) {
  const theme = useChartTheme();
  const s = series[0]!;
  const color = theme[slotVar(s.slot)];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.18} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={theme['--grid']} />
        <XAxis dataKey={xKey} tickFormatter={xFormatter} tickLine={false} axisLine={{ stroke: theme['--rule-strong'] }} minTickGap={32} />
        <YAxis tickFormatter={formatCompact} tickLine={false} axisLine={false} width={56} />
        {zeroLine && <ReferenceLine y={0} stroke={theme['--neg']} strokeDasharray="3 3" />}
        <Tooltip
          cursor={{ stroke: theme['--rule-strong'], strokeWidth: 1 }}
          content={(p) => <MoneyTooltip {...(p as TooltipContentProps<number, string>)} series={series} formatLabel={tooltipLabel ?? xFormatter} />}
        />
        <Area type="linear" dataKey={s.key} name={s.label} stroke={color} strokeWidth={2} fill={`url(#fill-${s.key})`} isAnimationActive={false} activeDot={{ r: 4, strokeWidth: 2, stroke: theme['--surface'] }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/**
 * Ranking de categorias em barras horizontais HTML: um único tom (magnitude),
 * rótulo direto com valor e participação — legível sem depender de cor.
 */
export function CategoryBars({ rows, limit = 8, extra }: { rows: { name: string; total: string; share: string }[]; limit?: number; extra?: (i: number) => ReactNode }) {
  const top = rows.slice(0, limit);
  const max = Math.max(...top.map((r) => Number(r.total)), 1);
  if (top.length === 0) return <p className="py-6 text-sm text-ink-3">Nenhuma despesa no período.</p>;
  return (
    <ul className="space-y-2.5">
      {top.map((r, i) => (
        <li key={r.name} title={`${r.name}: ${formatBRL(r.total)} (${formatPercent(r.share)})`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{r.name}</span>
            <span className="num shrink-0 text-ink-2">
              {formatBRL(r.total)} <span className="text-ink-3">· {formatPercent(r.share, 0)}</span>
              {extra?.(i)}
            </span>
          </div>
          <div className="h-2 rounded-full bg-sunken">
            <div className="h-2 rounded-full" style={{ width: `${(Number(r.total) / max) * 100}%`, background: 'var(--series-1)' }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Alternância gráfico/tabela (acessibilidade e conferência de valores). */
export function ChartOrTable({ chart, table }: { chart: ReactNode; table: ReactNode }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button type="button" onClick={() => setView(view === 'chart' ? 'table' : 'chart')} className={cx('text-[13px] text-ink-3 underline-offset-2 hover:text-ink hover:underline')}>
          {view === 'chart' ? 'Ver como tabela' : 'Ver gráfico'}
        </button>
      </div>
      {view === 'chart' ? chart : table}
    </div>
  );
}
