/**
 * Investimentos — apenas registro e organização (tipo, liquidez, prazo, objetivo).
 * Por decisão de produto, NÃO há recomendações automáticas nesta versão.
 */
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Database } from '../../db/client.js';
import { financialGoals, investmentStatusEnum, investmentTypeEnum, investments } from '../../db/schema.js';
import { diffDays } from '../../domain/dates.js';
import { today } from '../../lib/clock.js';
import { fromCents, normalizeMoney, toCents } from '../../lib/money.js';
import { businessRule, notFound } from '../../shared/errors.js';
import { errorResponseSchema, idParamsSchema, isoDateSchema, positiveMoneySchema, signedMoneySchema, uuidSchema } from '../../shared/schemas.js';
import { AccountsService } from '../accounts/accounts.service.js';

type InvestmentRow = typeof investments.$inferSelect;

const rate = z.string().trim().regex(/^-?\d{1,3}(\.\d{1,4})?$/, 'Taxa em % a.a., ex.: "12.5"');
const nonNegativeMoney = signedMoneySchema.refine((v) => !v.startsWith('-'), 'Não pode ser negativo');

const baseShape = {
  name: z.string().trim().min(1).max(120),
  type: z.enum(investmentTypeEnum.enumValues),
  investedAmount: positiveMoneySchema,
  currentAmount: nonNegativeMoney.optional(),
  investedAt: isoDateSchema,
  rateDescription: z.string().trim().max(60).optional(),
  annualRate: rate.optional(),
  /** 0 = liquidez diária. Omitido = só no vencimento. */
  liquidityDays: z.number().int().min(0).max(36500).optional(),
  maturityDate: isoDateSchema.optional(),
  objective: z.string().trim().max(255).optional(),
  accountId: uuidSchema.optional(),
  goalId: uuidSchema.optional(),
  notes: z.string().trim().max(2000).optional(),
};

export const createInvestmentBodySchema = z
  .object(baseShape)
  .refine((b) => !b.maturityDate || b.maturityDate >= b.investedAt, {
    message: 'Vencimento deve ser posterior à data de aplicação',
    path: ['maturityDate'],
  });

export const updateInvestmentBodySchema = z
  .object({
    name: baseShape.name,
    currentAmount: nonNegativeMoney.nullable(),
    rateDescription: z.string().trim().max(60).nullable(),
    annualRate: rate.nullable(),
    liquidityDays: z.number().int().min(0).max(36500).nullable(),
    maturityDate: isoDateSchema.nullable(),
    objective: z.string().trim().max(255).nullable(),
    goalId: uuidSchema.nullable(),
    notes: z.string().trim().max(2000).nullable(),
    /** Marca como resgatado nesta data. */
    redeemedAt: isoDateSchema.nullable(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Envie ao menos um campo para atualizar');

const liquidityBucket = z.enum(['daily', 'up_to_30_days', 'up_to_1_year', 'over_1_year', 'at_maturity']);

export const investmentResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: z.enum(investmentTypeEnum.enumValues),
  status: z.enum(investmentStatusEnum.enumValues),
  investedAmount: z.string(),
  currentAmount: z.string().nullable(),
  /** currentAmount − investedAmount (quando informado). */
  gain: z.string().nullable(),
  gainPercent: z.string().nullable(),
  investedAt: z.string(),
  rateDescription: z.string().nullable(),
  annualRate: z.string().nullable(),
  liquidityDays: z.number().nullable(),
  liquidityBucket,
  maturityDate: z.string().nullable(),
  daysToMaturity: z.number().nullable(),
  objective: z.string().nullable(),
  accountId: z.uuid().nullable(),
  goalId: z.uuid().nullable(),
  notes: z.string().nullable(),
  redeemedAt: z.string().nullable(),
});

export const investmentSummarySchema = z.object({
  totalInvested: z.string(),
  /** Usa o valor atual informado; na falta, o investido. */
  totalCurrent: z.string(),
  byType: z.array(z.object({ type: z.string(), invested: z.string(), current: z.string(), count: z.number() })),
  byLiquidity: z.array(z.object({ bucket: liquidityBucket, current: z.string(), count: z.number() })),
  maturingNext90Days: z.array(z.object({ id: z.uuid(), name: z.string(), maturityDate: z.string(), current: z.string() })),
});

function bucketOf(row: InvestmentRow): z.infer<typeof liquidityBucket> {
  const d = row.liquidityDays;
  if (d === null) return 'at_maturity';
  if (d <= 1) return 'daily';
  if (d <= 30) return 'up_to_30_days';
  if (d <= 365) return 'up_to_1_year';
  return 'over_1_year';
}

function toResponse(r: InvestmentRow, now: string): z.infer<typeof investmentResponseSchema> {
  const invested = toCents(normalizeMoney(r.investedAmount));
  const current = r.currentAmount === null ? null : toCents(normalizeMoney(r.currentAmount));
  const gain = current === null ? null : current - invested;
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    status: r.status,
    investedAmount: fromCents(invested),
    currentAmount: current === null ? null : fromCents(current),
    gain: gain === null ? null : fromCents(gain),
    gainPercent: gain === null ? null : (Number((gain * 10000n) / invested) / 100).toFixed(2),
    investedAt: r.investedAt,
    rateDescription: r.rateDescription,
    annualRate: r.annualRate ? Number(r.annualRate).toFixed(2) : null,
    liquidityDays: r.liquidityDays,
    liquidityBucket: bucketOf(r),
    maturityDate: r.maturityDate,
    daysToMaturity: r.maturityDate ? diffDays(now, r.maturityDate) : null,
    objective: r.objective,
    accountId: r.accountId,
    goalId: r.goalId,
    notes: r.notes,
    redeemedAt: r.redeemedAt,
  };
}

export class InvestmentsService {
  constructor(private readonly db: Database) {}

  async list(userId: string, includeRedeemed: boolean) {
    const rows = await this.db
      .select()
      .from(investments)
      .where(and(eq(investments.userId, userId), includeRedeemed ? undefined : eq(investments.status, 'active')))
      .orderBy(asc(investments.name));
    const now = today();
    return rows.map((r) => toResponse(r, now));
  }

  async get(userId: string, id: string) {
    return toResponse(await this.findOwned(userId, id), today());
  }

  async create(userId: string, input: z.infer<typeof createInvestmentBodySchema>) {
    await this.validateLinks(userId, input.accountId, input.goalId);
    const [row] = await this.db
      .insert(investments)
      .values({
        userId,
        ...input,
        investedAmount: normalizeMoney(input.investedAmount),
        currentAmount: input.currentAmount ? normalizeMoney(input.currentAmount) : null,
      })
      .returning();
    return toResponse(row!, today());
  }

  async update(userId: string, id: string, input: z.infer<typeof updateInvestmentBodySchema>) {
    const current = await this.findOwned(userId, id);
    await this.validateLinks(userId, undefined, input.goalId ?? undefined);
    if (input.maturityDate && input.maturityDate < current.investedAt) {
      throw businessRule('Vencimento deve ser posterior à data de aplicação');
    }
    const { redeemedAt, ...rest } = input;
    const [row] = await this.db
      .update(investments)
      .set({
        ...rest,
        ...(input.currentAmount && { currentAmount: normalizeMoney(input.currentAmount) }),
        ...(redeemedAt !== undefined && { redeemedAt, status: redeemedAt ? 'redeemed' : 'active' }),
      })
      .where(eq(investments.id, id))
      .returning();
    return toResponse(row!, today());
  }

  async remove(userId: string, id: string) {
    await this.findOwned(userId, id);
    await this.db.delete(investments).where(eq(investments.id, id));
  }

  async summary(userId: string) {
    const list = await this.list(userId, false);
    const value = (i: (typeof list)[number]) => toCents(i.currentAmount ?? i.investedAmount);

    const byType = new Map<string, { invested: bigint; current: bigint; count: number }>();
    const byLiquidity = new Map<string, { current: bigint; count: number }>();
    for (const i of list) {
      const t = byType.get(i.type) ?? { invested: 0n, current: 0n, count: 0 };
      t.invested += toCents(i.investedAmount);
      t.current += value(i);
      t.count++;
      byType.set(i.type, t);
      const l = byLiquidity.get(i.liquidityBucket) ?? { current: 0n, count: 0 };
      l.current += value(i);
      l.count++;
      byLiquidity.set(i.liquidityBucket, l);
    }
    const order = ['daily', 'up_to_30_days', 'up_to_1_year', 'over_1_year', 'at_maturity'] as const;

    return {
      totalInvested: fromCents(list.reduce((a, i) => a + toCents(i.investedAmount), 0n)),
      totalCurrent: fromCents(list.reduce((a, i) => a + value(i), 0n)),
      byType: [...byType.entries()]
        .sort((a, b) => (b[1].current > a[1].current ? 1 : -1))
        .map(([type, t]) => ({ type, invested: fromCents(t.invested), current: fromCents(t.current), count: t.count })),
      byLiquidity: order
        .filter((b) => byLiquidity.has(b))
        .map((bucket) => ({ bucket, current: fromCents(byLiquidity.get(bucket)!.current), count: byLiquidity.get(bucket)!.count })),
      maturingNext90Days: list
        .filter((i) => i.maturityDate && i.daysToMaturity !== null && i.daysToMaturity >= 0 && i.daysToMaturity <= 90)
        .sort((a, b) => a.maturityDate!.localeCompare(b.maturityDate!))
        .map((i) => ({ id: i.id, name: i.name, maturityDate: i.maturityDate!, current: fromCents(value(i)) })),
    };
  }

  private async validateLinks(userId: string, accountId?: string, goalId?: string) {
    if (accountId) {
      const acc = await AccountsService.requireActiveAccount(this.db, userId, accountId);
      if (acc.type !== 'investment') throw businessRule('A conta vinculada deve ser do tipo investimento');
    }
    if (goalId) {
      const [g] = await this.db
        .select({ id: financialGoals.id })
        .from(financialGoals)
        .where(and(eq(financialGoals.id, goalId), eq(financialGoals.userId, userId)));
      if (!g) throw notFound('Meta');
    }
  }

  private async findOwned(userId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(investments)
      .where(and(eq(investments.id, id), eq(investments.userId, userId)));
    if (!row) throw notFound('Investimento');
    return row;
  }
}

export const investmentsRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new InvestmentsService(app.db);
  app.addHook('onRequest', app.authenticate);
  const tags = ['investments'];
  const errors = { 404: errorResponseSchema, 422: errorResponseSchema };

  app.get(
    '/',
    {
      schema: {
        tags,
        querystring: z.object({
          includeRedeemed: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
        }),
        response: { 200: z.object({ data: z.array(investmentResponseSchema) }) },
      },
    },
    async (request) => ({ data: await service.list(request.userId, request.query.includeRedeemed) }),
  );

  app.get('/summary', { schema: { tags, response: { 200: investmentSummarySchema } } }, async (request) =>
    service.summary(request.userId),
  );

  app.post(
    '/',
    { schema: { tags, body: createInvestmentBodySchema, response: { 201: investmentResponseSchema, ...errors } } },
    async (request, reply) => reply.status(201).send(await service.create(request.userId, request.body)),
  );

  app.get(
    '/:id',
    { schema: { tags, params: idParamsSchema, response: { 200: investmentResponseSchema, ...errors } } },
    async (request) => service.get(request.userId, request.params.id),
  );

  app.patch(
    '/:id',
    { schema: { tags, params: idParamsSchema, body: updateInvestmentBodySchema, response: { 200: investmentResponseSchema, ...errors } } },
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
