import { useAccounts, useCategories } from '../api/hooks';
import type { AccountType } from '../api/types';
import { Select } from './ui';

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  checking: 'Conta corrente',
  savings: 'Poupança',
  investment: 'Investimento',
  wallet: 'Carteira',
  credit_card: 'Cartão de crédito',
  other: 'Outra',
};

export function AccountSelect({
  id,
  value,
  onChange,
  types,
  allowEmpty,
  emptyLabel = 'Selecione…',
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  types?: AccountType[];
  allowEmpty?: boolean;
  emptyLabel?: string;
}) {
  const { data = [] } = useAccounts();
  const list = types ? data.filter((a) => types.includes(a.type)) : data;
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {(allowEmpty || !value) && <option value="">{emptyLabel}</option>}
      {list.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </Select>
  );
}

/** Categorias agrupadas por categoria pai, filtradas por tipo. */
export function CategorySelect({ id, value, onChange, type }: { id?: string; value: string; onChange: (v: string) => void; type: 'income' | 'expense' }) {
  const { data = [] } = useCategories();
  const list = data.filter((c) => c.type === type);
  const parents = list.filter((c) => !c.parentId);
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Sem categoria (aplicar regras)</option>
      {parents.map((p) => {
        const children = list.filter((c) => c.parentId === p.id);
        return children.length ? (
          <optgroup key={p.id} label={p.name}>
            <option value={p.id}>{p.name} (geral)</option>
            {children.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        ) : (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        );
      })}
    </Select>
  );
}
