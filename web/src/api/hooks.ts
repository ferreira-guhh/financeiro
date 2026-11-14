import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get } from './client';
import type { Account, Category, CreditCard, Goal, List } from './types';

/** Dados de referência usados em muitos formulários. */
export const useAccounts = (includeInactive = false) =>
  useQuery({
    queryKey: ['accounts', includeInactive],
    queryFn: () => get<{ data: Account[] }>(`/accounts?includeInactive=${includeInactive}`),
    select: (r) => r.data,
  });

export const useCategories = () =>
  useQuery({ queryKey: ['categories'], queryFn: () => get<List<Category>>('/categories'), select: (r) => r.data, staleTime: 60_000 });

export const useCards = () =>
  useQuery({ queryKey: ['credit-cards'], queryFn: () => get<List<CreditCard>>('/credit-cards'), select: (r) => r.data });

export const useGoals = () => useQuery({ queryKey: ['goals'], queryFn: () => get<List<Goal>>('/goals'), select: (r) => r.data });

/**
 * Mutação que, ao concluir, invalida TODAS as consultas: qualquer lançamento afeta saldos,
 * faturas, dashboard e relatórios — mais simples e correto do que invalidar seletivamente.
 */
export function useAction<TVars, TResult = unknown>(fn: (vars: TVars) => Promise<TResult>, onSuccess?: (r: TResult) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (result) => {
      await qc.invalidateQueries();
      onSuccess?.(result);
    },
  });
}

/** Mapa id → nome de categoria (com "Pai › Filha"). */
export function categoryLabel(categories: Category[] | undefined) {
  const byId = new Map((categories ?? []).map((c) => [c.id, c]));
  return (id: string | null | undefined) => {
    if (!id) return null;
    const c = byId.get(id);
    if (!c) return null;
    const parent = c.parentId ? byId.get(c.parentId) : undefined;
    return parent ? `${parent.name} › ${c.name}` : c.name;
  };
}
