/**
 * Regras de categorização (de/para) — ex.: contém "IFOOD" → Alimentação.
 */
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Database } from '../../db/client.js';
import { categories, categoryRules, ruleMatchTypeEnum, transactions } from '../../db/schema.js';
import { AppError, PG_UNIQUE_VIOLATION, businessRule, getPgError, notFound } from '../../shared/errors.js';
import { errorResponseSchema, idParamsSchema, uuidSchema } from '../../shared/schemas.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { CategoriesService } from '../categories/categories.service.js';
import { RuleSuggester, ruleMatches, suggestPattern } from './categorizer.js';

const matchType = z.enum(ruleMatchTypeEnum.enumValues);

const ruleBody = z
  .object({
    categoryId: uuidSchema,
    matchType: matchType.default('contains'),
    pattern: z.string().trim().min(1).max(255),
    accountId: uuidSchema.optional(),
    priority: z.number().int().min(0).max(10000).default(100),
  })
  .refine((b) => b.matchType !== 'regex' || isValidRegex(b.pattern), { message: 'Expressão regular inválida', path: ['pattern'] });

const updateBody = z
  .object({
    categoryId: uuidSchema,
    matchType,
    pattern: z.string().trim().min(1).max(255),
    priority: z.number().int().min(0).max(10000),
    isActive: z.boolean(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Envie ao menos um campo para atualizar')
  .refine((b) => !b.pattern || b.matchType !== 'regex' || isValidRegex(b.pattern), { message: 'Expressão regular inválida', path: ['pattern'] });

const ruleResponse = z.object({
  id: z.uuid(),
  categoryId: z.uuid(),
  categoryName: z.string(),
  matchType,
  pattern: z.string(),
  accountId: z.uuid().nullable(),
  priority: z.number(),
  isActive: z.boolean(),
});

function isValidRegex(p: string) {
  try {
    new RegExp(p, 'i');
    return p.length <= 200;
  } catch {
    return false;
  }
}

export class CategoryRulesService {
  constructor(private readonly db: Database) {}

  async list(userId: string) {
    const rows = await this.db
      .select({ rule: categoryRules, categoryName: categories.name })
      .from(categoryRules)
      .innerJoin(categories, eq(categories.id, categoryRules.categoryId))
      .where(eq(categoryRules.userId, userId))
      .orderBy(asc(categoryRules.priority), asc(categoryRules.createdAt));
    return rows.map((r) => toResponse(r.rule, r.categoryName));
  }

  async create(userId: string, input: z.infer<typeof ruleBody>) {
    await CategoriesService.requireUsableCategory(this.db, userId, input.categoryId);
    if (input.accountId) await AccountsService.requireActiveAccount(this.db, userId, input.accountId);
    try {
      const [row] = await this.db
        .insert(categoryRules)
        .values({ userId, ...input, accountId: input.accountId ?? null })
        .returning();
      return this.get(userId, row!.id);
    } catch (err) {
      if (getPgError(err)?.code === PG_UNIQUE_VIOLATION) throw new AppError(409, 'CONFLICT', 'Já existe uma regra igual');
      throw err;
    }
  }

  async get(userId: string, id: string) {
    const [r] = await this.db
      .select({ rule: categoryRules, categoryName: categories.name })
      .from(categoryRules)
      .innerJoin(categories, eq(categories.id, categoryRules.categoryId))
      .where(and(eq(categoryRules.id, id), eq(categoryRules.userId, userId)));
    if (!r) throw notFound('Regra');
    return toResponse(r.rule, r.categoryName);
  }

  async update(userId: string, id: string, input: z.infer<typeof updateBody>) {
    const current = await this.get(userId, id);
    if (input.categoryId) await CategoriesService.requireUsableCategory(this.db, userId, input.categoryId);
    if ((input.matchType ?? current.matchType) === 'regex' && !isValidRegex(input.pattern ?? current.pattern)) {
      throw businessRule('Expressão regular inválida');
    }
    await this.db.update(categoryRules).set(input).where(eq(categoryRules.id, id));
    return this.get(userId, id);
  }

  async remove(userId: string, id: string) {
    await this.get(userId, id);
    await this.db.delete(categoryRules).where(eq(categoryRules.id, id));
  }

  /** Mostra qual regra (se alguma) categorizaria a descrição. */
  async test(userId: string, description: string, type: 'income' | 'expense', accountId?: string) {
    const suggester = await RuleSuggester.load(this.db, userId);
    const match = suggester.suggest({ description, type, accountId: accountId ?? '' });
    const rules = await this.list(userId);
    return {
      matched: match ? rules.find((r) => r.id === match.ruleId) ?? null : null,
      suggestedPattern: suggestPattern(description),
    };
  }

  /** Aplica as regras às transações SEM categoria (não mexe no que o usuário já categorizou). */
  async applyToUncategorized(userId: string) {
    const suggester = await RuleSuggester.load(this.db, userId);
    const rows = await this.db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          isNull(transactions.categoryId),
          or(eq(transactions.type, 'income'), eq(transactions.type, 'expense')),
          sql`${transactions.status} <> 'cancelled'`,
        ),
      );
    const byCategory = new Map<string, string[]>();
    for (const t of rows) {
      const type = (t.type === 'income' ? 'income' : 'expense') as 'income' | 'expense';
      const hit = suggester.suggest({ description: t.rawDescription, accountId: t.accountId, type }) ??
        suggester.suggest({ description: t.description, accountId: t.accountId, type });
      if (hit) byCategory.set(hit.categoryId, [...(byCategory.get(hit.categoryId) ?? []), t.id]);
    }
    let updated = 0;
    for (const [categoryId, ids] of byCategory) {
      await this.db.update(transactions).set({ categoryId }).where(inArray(transactions.id, ids));
      updated += ids.length;
    }
    return { scanned: rows.length, categorized: updated };
  }
}

function toResponse(rule: typeof categoryRules.$inferSelect, categoryName: string) {
  return {
    id: rule.id,
    categoryId: rule.categoryId,
    categoryName,
    matchType: rule.matchType,
    pattern: rule.pattern,
    accountId: rule.accountId,
    priority: rule.priority,
    isActive: rule.isActive,
  };
}

export const categoryRulesRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new CategoryRulesService(app.db);
  app.addHook('onRequest', app.authenticate);
  const tags = ['category-rules'];
  const errors = { 404: errorResponseSchema, 409: errorResponseSchema, 422: errorResponseSchema };

  app.get('/', { schema: { tags, response: { 200: z.object({ data: z.array(ruleResponse) }) } } }, async (request) => ({
    data: await service.list(request.userId),
  }));

  app.post(
    '/',
    { schema: { tags, body: ruleBody, response: { 201: ruleResponse, ...errors } } },
    async (request, reply) => reply.status(201).send(await service.create(request.userId, request.body)),
  );

  app.post(
    '/test',
    {
      schema: {
        tags,
        body: z.object({ description: z.string().min(1).max(255), type: z.enum(['income', 'expense']).default('expense'), accountId: uuidSchema.optional() }),
        response: { 200: z.object({ matched: ruleResponse.nullable(), suggestedPattern: z.string() }) },
      },
    },
    async (request) => service.test(request.userId, request.body.description, request.body.type, request.body.accountId),
  );

  app.post(
    '/apply',
    { schema: { tags, response: { 200: z.object({ scanned: z.number(), categorized: z.number() }) } } },
    async (request) => service.applyToUncategorized(request.userId),
  );

  app.patch(
    '/:id',
    { schema: { tags, params: idParamsSchema, body: updateBody, response: { 200: ruleResponse, ...errors } } },
    async (request) => service.update(request.userId, request.params.id, request.body),
  );

  app.delete(
    '/:id',
    { schema: { tags, params: idParamsSchema, response: { 204: z.null(), ...errors } } },
    async (request, reply) => {
      await service.remove(request.userId, request.params.id);
      return reply.status(204).send(null);
    },
  );
};

// Exportado para testes.
export { ruleMatches };
