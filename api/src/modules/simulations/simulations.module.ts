/**
 * Simulador "E se?" — expõe o motor puro (src/domain/simulation) via HTTP.
 * Nada aqui grava no banco: simulações nunca alteram o livro-caixa.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { addMonthsToKey, monthKey, monthsBetween } from '../../domain/dates.js';
import { goalTimeline, requiredMonthlyContribution } from '../../domain/simulation/goals.js';
import { projectSavings } from '../../domain/simulation/savings.js';
import { runScenario } from '../../domain/simulation/scenario.js';
import { D, money } from '../../domain/simulation/decimal.js';
import { today } from '../../lib/clock.js';
import { errorResponseSchema, isoDateSchema, positiveMoneySchema, signedMoneySchema, uuidSchema } from '../../shared/schemas.js';
import { monthKeySchema } from '../analytics/analytics.schemas.js';
import { budgetBaseline } from '../analytics/budget.js';
import { GoalsService } from '../goals/goals.service.js';

const nonNegativeMoney = signedMoneySchema.refine((v) => !v.startsWith('-'), 'Não pode ser negativo');
const rate = z.string().trim().regex(/^-?\d{1,3}(\.\d{1,4})?$/, 'Percentual a.a., ex.: "10.5"').refine((v) => Number(v) > -100, 'Maior que -100%');
const months = z.number().int().min(1).max(600);

// ─── Schemas ─────────────────────────────────────────────────────────────────

const savingsBody = z.object({
  initialAmount: nonNegativeMoney.default('0.00'),
  monthlyContribution: nonNegativeMoney,
  annualRatePercent: rate.default('0'),
  months,
  annualInflationPercent: rate.optional(),
  annualContributionIncreasePercent: rate.optional(),
  contributionTiming: z.enum(['start', 'end']).default('end'),
});

const savingsResponse = z.object({
  months: z.array(
    z.object({
      month: z.string(),
      contribution: z.string(),
      interest: z.string(),
      balance: z.string(),
      totalContributed: z.string(),
      totalInterest: z.string(),
      realBalance: z.string(),
    }),
  ),
  summary: z.object({
    finalBalance: z.string(),
    totalContributed: z.string(),
    totalInterest: z.string(),
    finalRealBalance: z.string(),
    interestShare: z.string(),
  }),
});

const goalBody = z
  .object({
    /** Preenche alvo, valor atual, aporte e taxa a partir de uma meta existente. */
    goalId: uuidSchema.optional(),
    targetAmount: positiveMoneySchema.optional(),
    currentAmount: nonNegativeMoney.optional(),
    monthlyContribution: nonNegativeMoney.optional(),
    annualRatePercent: rate.optional(),
    /** "E se eu guardar X a mais por mês?" (ex.: cortando delivery). */
    extraMonthly: nonNegativeMoney.optional(),
    /** Calcula o aporte necessário para chegar até esta data. */
    targetDate: isoDateSchema.optional(),
  })
  .refine((b) => b.goalId || b.targetAmount, { message: 'Informe goalId ou targetAmount', path: ['targetAmount'] });

const timelineShape = z.object({
  monthlyContribution: z.string(),
  reached: z.boolean(),
  months: z.number().nullable(),
  reachedMonth: z.string().nullable(),
  totalContributed: z.string(),
  totalInterest: z.string(),
  series: z.array(z.object({ month: z.string(), balance: z.string() })),
});

const goalResponse = z.object({
  goalName: z.string().nullable(),
  targetAmount: z.string(),
  currentAmount: z.string(),
  annualRatePercent: z.string(),
  remaining: z.string(),
  baseline: timelineShape,
  withExtra: timelineShape.nullable(),
  /** Negativo = meses antecipados com o valor extra. */
  monthsSaved: z.number().nullable(),
  requiredForTargetDate: z.string().nullable(),
});

const baselineShape = z.object({
  startMonth: z.string(),
  months: z.number(),
  startingBalance: z.string(),
  monthlyIncome: z.string(),
  monthlyFixedExpenses: z.string(),
  monthlyVariableExpenses: z.string(),
  installmentsByMonth: z.record(z.string(), z.string()),
});

const scenarioBody = z.object({
  months: z.number().int().min(1).max(120).default(24),
  /** Sobrescreve números da linha de base calculada a partir dos seus dados. */
  baseline: z
    .object({
      startingBalance: signedMoneySchema,
      monthlyIncome: nonNegativeMoney,
      monthlyFixedExpenses: nonNegativeMoney,
      monthlyVariableExpenses: nonNegativeMoney,
    })
    .partial()
    .optional(),
  adjustments: z
    .object({
      incomeChange: z
        .object({ amount: signedMoneySchema.optional(), percent: rate.optional(), startMonth: monthKeySchema.optional() })
        .optional(),
      expenseCuts: z
        .array(z.object({ label: z.string().max(80), monthlyAmount: positiveMoneySchema, startMonth: monthKeySchema.optional() }))
        .max(20)
        .optional(),
      newRecurringExpenses: z
        .array(
          z.object({
            label: z.string().max(80),
            monthlyAmount: positiveMoneySchema,
            startMonth: monthKeySchema.optional(),
            endMonth: monthKeySchema.optional(),
          }),
        )
        .max(20)
        .optional(),
      newInstallmentPurchases: z
        .array(
          z.object({
            label: z.string().max(80),
            totalAmount: positiveMoneySchema,
            installments: z.number().int().min(1).max(120),
            startMonth: monthKeySchema.optional(),
          }),
        )
        .max(20)
        .optional(),
    })
    .default({}),
  /** Mede o impacto do cenário no prazo desta meta. */
  goalId: uuidSchema.optional(),
});

const timelinePick = z.object({ reached: z.boolean(), months: z.number().nullable(), reachedMonth: z.string().nullable() });

const scenarioResponse = z.object({
  baseline: baselineShape,
  months: z.array(
    z.object({
      month: z.string(),
      baselineIncome: z.string(),
      baselineExpenses: z.string(),
      baselineNet: z.string(),
      scenarioIncome: z.string(),
      scenarioExpenses: z.string(),
      scenarioNet: z.string(),
      baselineBalance: z.string(),
      scenarioBalance: z.string(),
    }),
  ),
  summary: z.object({
    baselineFinalBalance: z.string(),
    scenarioFinalBalance: z.string(),
    difference: z.string(),
    averageMonthlyDifference: z.string(),
    scenarioFirstNegativeMonth: z.string().nullable(),
  }),
  goalImpact: z
    .object({ goal: z.string(), baseline: timelinePick, scenario: timelinePick, monthsDifference: z.number().nullable() })
    .nullable(),
});

// ─── Rotas ───────────────────────────────────────────────────────────────────

export const simulationsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.authenticate);
  const tags = ['simulations'];
  const goals = new GoalsService(app.db);

  app.post(
    '/savings',
    { schema: { tags, body: savingsBody, response: { 200: savingsResponse } } },
    async (request) => projectSavings({ ...request.body, startMonth: addMonthsToKey(monthKey(today()), 1) }),
  );

  app.post(
    '/goal',
    { schema: { tags, body: goalBody, response: { 200: goalResponse, 404: errorResponseSchema } } },
    async (request) => {
      const b = request.body;
      const goal = b.goalId ? await goals.get(request.userId, b.goalId) : null;
      const target = b.targetAmount ?? goal!.targetAmount;
      const current = b.currentAmount ?? goal?.currentAmount ?? '0.00';
      const contribution = b.monthlyContribution ?? goal?.monthlyContribution ?? '0.00';
      const ratePct = b.annualRatePercent ?? goal?.expectedAnnualRate ?? '0';
      const targetDate = b.targetDate ?? goal?.targetDate ?? null;
      const startMonth = monthKey(today());

      const run = (c: string) => ({
        monthlyContribution: money(new D(c)),
        ...goalTimeline({ targetAmount: target, currentAmount: current, monthlyContribution: c, annualRatePercent: ratePct, startMonth }),
      });
      const baseline = run(contribution);
      const withExtra = b.extraMonthly ? run(money(new D(contribution).plus(b.extraMonthly))) : null;
      const remaining = D.max(new D(target).minus(current), 0);
      const monthsLeft = targetDate ? Math.max(1, monthsBetween(startMonth, monthKey(targetDate)) + 1) : null;

      return {
        goalName: goal?.name ?? null,
        targetAmount: money(new D(target)),
        currentAmount: money(new D(current)),
        annualRatePercent: new D(ratePct).toFixed(2),
        remaining: money(remaining),
        baseline,
        withExtra,
        monthsSaved:
          withExtra && baseline.months !== null && withExtra.months !== null ? withExtra.months - baseline.months : null,
        requiredForTargetDate: monthsLeft
          ? requiredMonthlyContribution({ targetAmount: target, currentAmount: current, months: monthsLeft, annualRatePercent: ratePct })
          : null,
      };
    },
  );

  app.get(
    '/baseline',
    {
      schema: {
        tags,
        querystring: z.object({ months: z.coerce.number().int().min(1).max(120).default(24) }),
        response: { 200: baselineShape },
      },
    },
    async (request) => budgetBaseline(app.db, request.userId, request.query.months),
  );

  app.post(
    '/scenario',
    { schema: { tags, body: scenarioBody, response: { 200: scenarioResponse, 404: errorResponseSchema } } },
    async (request) => {
      const b = request.body;
      const computed = await budgetBaseline(app.db, request.userId, b.months);
      const baseline = { ...computed, ...b.baseline };
      let goal;
      if (b.goalId) {
        const g = await goals.get(request.userId, b.goalId);
        goal = {
          name: g.name,
          targetAmount: g.targetAmount,
          currentAmount: g.currentAmount,
          monthlyContribution: g.monthlyContribution ?? g.requiredMonthlyContribution ?? '0.00',
          annualRatePercent: g.expectedAnnualRate ?? '0',
        };
      }
      return { baseline, ...runScenario(baseline, b.adjustments, goal) };
    },
  );
};
