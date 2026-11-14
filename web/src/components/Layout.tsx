import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { post } from '../api/client';
import { useAuth } from '../lib/auth';
import { cx } from './ui';

const NAV: { group: string; items: { to: string; label: string }[] }[] = [
  {
    group: 'Visão geral',
    items: [
      { to: '/', label: 'Painel' },
      { to: '/previsao', label: 'Previsão de caixa' },
      { to: '/relatorios', label: 'Relatórios' },
    ],
  },
  {
    group: 'Dia a dia',
    items: [
      { to: '/lancamentos', label: 'Lançamentos' },
      { to: '/contas', label: 'Contas' },
      { to: '/cartoes', label: 'Cartões' },
      { to: '/recorrentes', label: 'Contas fixas' },
      { to: '/parcelamentos', label: 'Parcelamentos' },
    ],
  },
  {
    group: 'Planejamento',
    items: [
      { to: '/metas', label: 'Metas' },
      { to: '/simulador', label: 'Simulador' },
      { to: '/investimentos', label: 'Investimentos' },
    ],
  },
  {
    group: 'Dados',
    items: [
      { to: '/importar', label: 'Importar extrato' },
      { to: '/regras', label: 'Regras de categoria' },
      { to: '/configuracoes', label: 'Configurações' },
    ],
  },
];

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="space-y-6">
      {NAV.map((g) => (
        <div key={g.group}>
          <div className="mb-1.5 px-2.5 text-[12px] font-medium text-ink-3">{g.group}</div>
          <ul className="space-y-0.5">
            {g.items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cx(
                      'block rounded-md px-2.5 py-1.5 text-sm',
                      isActive ? 'bg-surface font-medium text-ink shadow-[inset_2px_0_0_var(--accent)]' : 'text-ink-2 hover:bg-sunken hover:text-ink',
                    )
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2 px-2.5">
      <svg viewBox="0 0 32 32" className="size-6" aria-hidden>
        <rect width="32" height="32" rx="7" fill="var(--accent)" />
        <path d="M8 22h16M8 16h11M8 10h16" stroke="var(--accent-ink)" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
      <span className="text-[17px] font-semibold tracking-[-0.01em]">Financeiro</span>
    </div>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const qc = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // Ao abrir o app: materializa parcelas e contas fixas que venceram (idempotente).
  useEffect(() => {
    post<{ installmentsPosted: number; recurringGenerated: number }>('/processing/run')
      .then((r) => (r.installmentsPosted || r.recurringGenerated ? qc.invalidateQueries() : undefined))
      .catch(() => undefined);
  }, [qc]);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="hidden border-r border-rule px-3 py-6 lg:flex lg:flex-col lg:gap-8">
        <Brand />
        <div className="flex-1">
          <Nav />
        </div>
        <div className="px-2.5 text-[13px] text-ink-3">
          <div className="truncate text-ink-2">{user?.name}</div>
          <button type="button" onClick={logout} className="mt-1 hover:text-ink hover:underline">
            Sair
          </button>
        </div>
      </aside>

      <div className="flex items-center justify-between border-b border-rule px-4 py-3 lg:hidden">
        <Brand />
        <button type="button" onClick={() => setMenuOpen((v) => !v)} className="rounded-md px-2.5 py-1.5 text-sm font-medium hover:bg-sunken" aria-expanded={menuOpen}>
          Menu
        </button>
      </div>
      {menuOpen && (
        <div className="border-b border-rule px-3 py-4 lg:hidden">
          <Nav onNavigate={() => setMenuOpen(false)} />
          <button type="button" onClick={logout} className="mt-4 px-2.5 text-sm text-ink-3">
            Sair
          </button>
        </div>
      )}

      <main className="mx-auto w-full max-w-[1180px] px-4 py-8 sm:px-8 lg:py-10">
        <Outlet />
      </main>
    </div>
  );
}
