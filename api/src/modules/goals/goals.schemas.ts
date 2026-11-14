import { z } from 'zod';
import { goalKindEnum, goalStatusEnum } from '../../db/schema.js';
import { hexColorSchema, isoDateSchema, positiveMoneySchema, signedMoneySchema, uuidSchema } from '../../shared/schemas.js';

const rateSchema = z
  .string()
  .trim()
  .regex(/^-?\d{1,3}(\.\d{1,4})?$/, 'Taxa em % a.a., ex.: "10.5"');

export const createGoalBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(goalKindEnum.enumValues).default('other'),
  targetAmount: positiveMoneySchema,
  initialAmount: signedMoneySchema.refine((v) => !v.startsWith('-'), 'Não pode ser negativo').default('0.00'),
  monthlyContribution: positiveMoneySchema.optional(),
  expectedAnnualRate: rateSchema.optional(),
  targetDate: isoDateSchema.optional(),
  linkedAccountId: uuidSchema.optional(),
  icon: z.string().trim().max(40).optional(),
  color: hexColorSchema.optional(),
});

export const updateGoalBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    kind: z.enum(goalKindEnum.enumValues),
    targetAmount: positiveMoneySchema,
    monthlyContribution: positiveMoneySchema.nullable(),
    expectedAnnualRate: rateSchema.nullable(),
    targetDate: isoDateSchema.nullable(),
    linkedAccountId: uuidSchema.nullable(),
    status: z.enum(goalStatusEnum.enumValues),
    icon: z.string().trim().max(40).nullable(),
    color: hexColorSchema.nullable(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Envie ao menos um campo para atualizar');

export const contributionBodySchema = z.object({
  /** Positivo = aporte; negativo = resgate. */
  amount: signedMoneySchema.refine((v) => !/^-?0+(\.0+)?$/.test(v), 'Valor não pode ser zero'),
  date: isoDateSchema,
  note: z.string().trim().max(255).optional(),
});

export const projectionQuerySchema = z.object({
  monthlyContribution: positiveMoneySchema.optional(),
  annualRate: rateSchema.optional(),
});

export const goalResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: z.enum(goalKindEnum.enumValues),
  status: z.enum(goalStatusEnum.enumValues),
  targetAmount: z.string(),
  initialAmount: z.string(),
  currentAmount: z.string(),
  remainingAmount: z.string(),
  progressPercent: z.string(),
  monthlyContribution: z.string().nullable(),
  expectedAnnualRate: z.string().nullable(),
  targetDate: z.string().nullable(),
  linkedAccountId: z.uuid().nullable(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  isReached: z.boolean(),
  /** Meses até a data-alvo (inclui o mês atual). */
  monthsLeft: z.number().nullable(),
  /** Quanto guardar por mês para chegar na data-alvo. */
  requiredMonthlyContribution: z.string().nullable(),
  /** Mês previsto de conclusão mantendo o aporte mensal desejado. */
  forecastMonth: z.string().nullable(),
  /** Previsão chega até a data-alvo? null sem data-alvo ou sem aporte. */
  onTrack: z.boolean().nullable(),
});

export const contributionResponseSchema = z.object({
  id: z.uuid(),
  amount: z.string(),
  date: z.string(),
  note: z.string().nullable(),
});

export const projectionResponseSchema = z.object({
  goal: goalResponseSchema,
  monthlyContribution: z.string(),
  annualRate: z.string(),
  reached: z.boolean(),
  months: z.number().nullable(),
  reachedMonth: z.string().nullable(),
  totalContributed: z.string(),
  totalInterest: z.string(),
  series: z.array(z.object({ month: z.string(), balance: z.string() })),
  /** Impacto de aumentar/diminuir o aporte. */
  alternatives: z.array(
    z.object({
      label: z.string(),
      monthlyContribution: z.string(),
      months: z.number().nullable(),
      reachedMonth: z.string().nullable(),
    }),
  ),
});

export type CreateGoalBody = z.infer<typeof createGoalBodySchema>;
export type UpdateGoalBody = z.infer<typeof updateGoalBodySchema>;
export type GoalResponse = z.infer<typeof goalResponseSchema>;
