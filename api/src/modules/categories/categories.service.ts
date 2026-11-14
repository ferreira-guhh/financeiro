import { and, asc, eq, isNull, or } from 'drizzle-orm';
import type { Database, DbExecutor } from '../../db/client.js';
import { categories } from '../../db/schema.js';
import { AppError, PG_UNIQUE_VIOLATION, businessRule, getPgError, notFound } from '../../shared/errors.js';
import type { CategoryResponse, CreateCategoryBody } from './categories.schemas.js';

type CategoryRow = typeof categories.$inferSelect;
type CashFlowType = CategoryRow['type'];

/** Categorias visíveis ao usuário: as dele + as do sistema. */
const visibleTo = (userId: string) => or(eq(categories.userId, userId), isNull(categories.userId));

export class CategoriesService {
  constructor(private readonly db: Database) {}

  async list(userId: string, filter: { type?: CashFlowType }): Promise<CategoryResponse[]> {
    const rows = await this.db
      .select()
      .from(categories)
      .where(
        and(
          visibleTo(userId),
          eq(categories.isArchived, false),
          filter.type ? eq(categories.type, filter.type) : undefined,
        ),
      )
      .orderBy(asc(categories.type), asc(categories.name));
    return rows.map(toCategoryResponse);
  }

  async create(userId: string, input: CreateCategoryBody): Promise<CategoryResponse> {
    if (input.parentId) {
      const parent = await CategoriesService.requireUsableCategory(this.db, userId, input.parentId);
      if (parent.parentId) throw businessRule('Subcategorias aceitam apenas um nível');
      if (parent.type !== input.type) {
        throw businessRule('Subcategoria deve ter o mesmo tipo (receita/despesa) da categoria pai');
      }
    }

    try {
      const [row] = await this.db
        .insert(categories)
        .values({ ...input, userId, parentId: input.parentId ?? null })
        .returning();
      return toCategoryResponse(row!);
    } catch (err) {
      if (getPgError(err)?.code === PG_UNIQUE_VIOLATION) {
        throw new AppError(409, 'CONFLICT', 'Já existe uma categoria com esse nome neste nível');
      }
      throw err;
    }
  }

  /** Categoria existe, é visível ao usuário, não está arquivada e (opcional) tem o tipo esperado. */
  static async requireUsableCategory(
    db: DbExecutor,
    userId: string,
    categoryId: string,
    expectedType?: CashFlowType,
  ): Promise<CategoryRow> {
    const [category] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.id, categoryId), visibleTo(userId)))
      .limit(1);

    if (!category) throw notFound('Categoria');
    if (category.isArchived) throw businessRule('Categoria arquivada', { categoryId });
    if (expectedType && category.type !== expectedType) {
      throw businessRule(
        `Categoria de ${category.type === 'income' ? 'receita' : 'despesa'} não pode ser usada em ${
          expectedType === 'income' ? 'receita' : 'despesa'
        }`,
        { categoryId },
      );
    }
    return category;
  }
}

function toCategoryResponse(row: CategoryRow): CategoryResponse {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    parentId: row.parentId,
    icon: row.icon,
    color: row.color,
    isEssential: row.isEssential,
    isSystem: row.userId === null,
  };
}
