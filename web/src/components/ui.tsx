/**
 * Componentes de interface. Vocabulário visual: filetes finos, raio pequeno (6px) em
 * controles, superfícies brancas sobre papel, números sempre tabulares.
 */
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { ApiError } from '../api/client';
import { formatBRL, isNegative, isPositive } from '../lib/format';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ─── Texto e valores ─────────────────────────────────────────────────────────

export function Money({ value, tone = 'auto', sign = false, className }: { value: string | null | undefined; tone?: 'auto' | 'plain' | 'muted'; sign?: boolean; className?: string }) {
  const color =
    tone === 'plain' ? '' : tone === 'muted' ? 'text-ink-3' : isNegative(value) ? 'text-neg' : isPositive(value) && sign ? 'text-pos' : '';
  // Dígitos tabulares (colunas alinham), pontuação proporcional (sem vão na vírgula).
  const parts = formatBRL(value, { sign }).split(/(\d+)/).filter(Boolean);
  return (
    <span className={cx('num money whitespace-nowrap', color, className)}>
      {parts.map((p, i) => (/^\d+$/.test(p) ? p : <span key={i} className="punct">{p}</span>))}
    </span>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.01em]">{title}</h1>
        {description && <p className="mt-1 text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4">
      <h2 className="text-[17px] font-semibold">{children}</h2>
      {aside && <div className="text-sm text-ink-3">{aside}</div>}
    </div>
  );
}

/** Bloco de conteúdo: superfície branca com filete; usado com parcimônia. */
export function Panel({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return <section className={cx('rounded-lg border border-rule bg-surface', padded && 'p-5', className)}>{children}</section>;
}

/** Par rótulo/valor para resumos. */
export function Stat({ label, value, hint, className }: { label: string; value: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="text-sm text-ink-2">{label}</div>
      <div className="num mt-0.5 whitespace-nowrap text-[19px] font-semibold leading-tight sm:text-[21px]">{value}</div>
      {hint && <div className="mt-0.5 text-[13px] text-ink-3">{hint}</div>}
    </div>
  );
}

const TONES = {
  neutral: 'bg-sunken text-ink-2',
  accent: 'bg-accent-soft text-accent',
  pos: 'bg-pos-soft text-pos',
  neg: 'bg-neg-soft text-neg',
  warn: 'bg-warn-soft text-warn',
};

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: keyof typeof TONES }) {
  return <span className={cx('inline-flex items-center rounded px-1.5 py-0.5 text-[12px] font-medium leading-tight', TONES[tone])}>{children}</span>;
}

// ─── Controles ───────────────────────────────────────────────────────────────

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' };

export function Button({ variant = 'secondary', size = 'md', className, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-9 px-3.5 text-sm',
        variant === 'primary' && 'bg-accent text-accent-ink hover:bg-accent-hover',
        variant === 'secondary' && 'border border-rule-strong bg-surface text-ink hover:bg-sunken',
        variant === 'ghost' && 'text-ink-2 hover:bg-sunken hover:text-ink',
        variant === 'danger' && 'border border-rule-strong bg-surface text-neg hover:bg-neg-soft',
        className,
      )}
    />
  );
}

const control =
  'h-9 w-full rounded-md border border-rule-strong bg-surface px-2.5 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25';

export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-[13px] font-medium text-ink-2">
        {label}
      </label>
      {children(id)}
      {hint && !error && <p className="mt-1 text-[12px] text-ink-3">{hint}</p>}
      {error && <p className="mt-1 text-[12px] text-neg">{error}</p>}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(control, props.className)} />;
}

export function MoneyInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <Input inputMode="decimal" placeholder="0,00" autoComplete="off" {...props} className={cx('num', props.className)} />;
}

export function Select({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cx(control, 'pr-8', props.className)}>
      {children}
    </select>
  );
}

export function Checkbox({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm">
      <input type="checkbox" className="mt-0.5 size-4 accent-[var(--accent)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint && <span className="block text-[12px] text-ink-3">{hint}</span>}
      </span>
    </label>
  );
}

/** Abas como controle segmentado. */
export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div role="tablist" className="inline-flex rounded-md border border-rule-strong bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          type="button"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx('h-7 rounded px-3 text-[13px] font-medium', value === o.value ? 'bg-ink text-paper' : 'text-ink-2 hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─── Estados ─────────────────────────────────────────────────────────────────

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof ApiError ? error.userMessage : error instanceof Error ? error.message : 'Algo deu errado';
  return (
    <div role="alert" className="rounded-md border border-neg/30 bg-neg-soft px-3 py-2 text-sm text-neg">
      {message}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-rule-strong px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-ink-2">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Loading({ label = 'Carregando…' }: { label?: string }) {
  return <p className="py-10 text-center text-sm text-ink-3">{label}</p>;
}

export function ProgressBar({ value, tone = 'accent' }: { value: number; tone?: 'accent' | 'pos' | 'warn' | 'neg' }) {
  const pct = Math.max(0, Math.min(100, value));
  const color = { accent: 'bg-accent', pos: 'bg-pos', warn: 'bg-warn', neg: 'bg-neg' }[tone];
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx('h-full rounded-full', color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ─── Modal ───────────────────────────────────────────────────────────────────

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgb(10_16_13/0.45)] p-4 pt-[8vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={cx('w-full rounded-lg border border-rule bg-surface shadow-[0_20px_60px_-20px_rgb(0_0_0/0.35)]', wide ? 'max-w-3xl' : 'max-w-lg')}>
        <div className="flex items-center justify-between border-b border-rule px-5 py-3.5">
          <h2 className="text-[17px] font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-ink-3 hover:bg-sunken hover:text-ink" aria-label="Fechar">
            <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 5l10 10M15 5L5 15" /></svg>
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/** Rodapé de formulário com erro + ações. */
export function FormActions({ error, children }: { error?: unknown; children: ReactNode }) {
  return (
    <div className="mt-5 space-y-3">
      <ErrorNote error={error} />
      <div className="flex justify-end gap-2">{children}</div>
    </div>
  );
}

// ─── Tabela ──────────────────────────────────────────────────────────────────

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('overflow-x-auto rounded-lg border border-rule bg-surface', className)}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export const Th = ({ children, right, className }: { children?: ReactNode; right?: boolean; className?: string }) => (
  <th className={cx('border-b border-rule px-4 py-2.5 text-left text-[13px] font-medium text-ink-2', right && 'text-right', className)}>{children}</th>
);

export const Td = ({ children, right, className, colSpan }: { children?: ReactNode; right?: boolean; className?: string; colSpan?: number }) => (
  <td colSpan={colSpan} className={cx('border-b border-rule px-4 py-2.5 align-middle', right && 'text-right', className)}>{children}</td>
);
