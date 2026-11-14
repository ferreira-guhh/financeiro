/**
 * Categorias padrão do sistema (user_id = NULL). Idempotente: pode rodar várias vezes.
 * Uso: npm run db:seed
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, isNull } from 'drizzle-orm';
import { createDatabase, type Database } from './client.js';
import { categories } from './schema.js';

type Seed = {
  name: string;
  type: 'income' | 'expense';
  icon: string;
  color: string;
  isEssential?: boolean;
  children?: string[];
};

const SYSTEM_CATEGORIES: Seed[] = [
  // Despesas essenciais
  { name: 'Moradia', type: 'expense', icon: 'home', color: '#6366F1', isEssential: true,
    children: ['Aluguel', 'Condomínio', 'Energia', 'Água', 'Internet', 'Manutenção'] },
  { name: 'Alimentação', type: 'expense', icon: 'utensils', color: '#F97316', isEssential: true,
    children: ['Supermercado', 'Restaurantes', 'Delivery'] },
  { name: 'Transporte', type: 'expense', icon: 'car', color: '#0EA5E9', isEssential: true,
    children: ['Combustível', 'Transporte público', 'Aplicativos', 'Manutenção do veículo'] },
  { name: 'Saúde', type: 'expense', icon: 'heart-pulse', color: '#EF4444', isEssential: true,
    children: ['Plano de saúde', 'Farmácia', 'Consultas'] },
  { name: 'Educação', type: 'expense', icon: 'graduation-cap', color: '#8B5CF6', isEssential: true },
  { name: 'Impostos e taxas', type: 'expense', icon: 'landmark', color: '#64748B', isEssential: true },
  // Despesas discricionárias
  { name: 'Lazer', type: 'expense', icon: 'party-popper', color: '#EC4899' },
  { name: 'Compras', type: 'expense', icon: 'shopping-bag', color: '#F59E0B' },
  { name: 'Assinaturas', type: 'expense', icon: 'repeat', color: '#14B8A6' },
  { name: 'Viagens', type: 'expense', icon: 'plane', color: '#06B6D4' },
  { name: 'Outras despesas', type: 'expense', icon: 'circle-ellipsis', color: '#94A3B8' },
  // Receitas
  { name: 'Salário', type: 'income', icon: 'briefcase', color: '#22C55E' },
  { name: 'Freelance', type: 'income', icon: 'laptop', color: '#10B981' },
  { name: 'Rendimentos', type: 'income', icon: 'trending-up', color: '#84CC16' },
  { name: 'Reembolsos', type: 'income', icon: 'undo-2', color: '#A3E635' },
  { name: 'Outras receitas', type: 'income', icon: 'plus-circle', color: '#4ADE80' },
];

async function findSystemCategory(
  db: Database,
  name: string,
  parentId: string | null,
) {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        isNull(categories.userId),
        eq(categories.name, name),
        parentId ? eq(categories.parentId, parentId) : isNull(categories.parentId),
      ),
    )
    .limit(1);
  return row?.id;
}

export async function seedSystemCategories(db: Database): Promise<number> {
  let created = 0;

  for (const seed of SYSTEM_CATEGORIES) {
    const { children = [], ...parent } = seed;
    const inserted = await db
      .insert(categories)
      .values({ ...parent, userId: null, parentId: null })
      .onConflictDoNothing()
      .returning({ id: categories.id });
    created += inserted.length;
    const parentId = inserted[0]?.id ?? (await findSystemCategory(db, parent.name, null));
    if (!parentId) throw new Error(`Categoria pai não encontrada: ${parent.name}`);

    for (const childName of children) {
      const child = await db
        .insert(categories)
        .values({
          name: childName,
          type: parent.type,
          isEssential: parent.isEssential ?? false,
          color: parent.color,
          userId: null,
          parentId,
        })
        .onConflictDoNothing()
        .returning({ id: categories.id });
      created += child.length;
    }
  }

  return created;
}

// Executado via `npm run db:seed` (não roda quando importado pelos testes).
// Comparação sem diferenciar maiúsculas: no Windows a letra do drive pode variar (C: x c:).
const isMain = process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  const { env } = await import('../config/env.js');
  const { db, pool } = createDatabase(env.DATABASE_URL);
  const created = await seedSystemCategories(db);
  console.log(`✅ Seed concluído: ${created} categorias novas`);
  await pool.end();
}
