/**
 * Parâmetros do usuário para o cálculo do gasto seguro (margem discricionária).
 */
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { DbExecutor } from '../../db/client.js';
import { incomeBasisEnum, userSettings } from '../../db/schema.js';
import { normalizeMoney } from '../../lib/money.js';
import { AppError } from '../../shared/errors.js';
import { positiveMoneySchema, signedMoneySchema } from '../../shared/schemas.js';

export type UserSettingsRow = typeof userSettings.$inferSelect;

const nonNegative = signedMoneySchema.refine((v) => !v.startsWith('-'), 'Não pode ser negativo');

export const settingsBodySchema = z
  .object({
    incomeBasis: z.enum(incomeBasisEnum.enumValues),
    fixedMonthlyIncome: positiveMoneySchema.nullable(),
    monthlyReserveAmount: nonNegative,
    includeGoalContributions: z.boolean(),
    safetyMarginPercent: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/, 'Percentual, ex.: "10"').refine((v) => Number(v) <= 100, 'Máximo 100%'),
  })
  .partial();

export const settingsResponseSchema = z.object({
  incomeBasis: z.enum(incomeBasisEnum.enumValues),
  fixedMonthlyIncome: z.string().nullable(),
  monthlyReserveAmount: z.string(),
  includeGoalContributions: z.boolean(),
  safetyMarginPercent: z.string(),
});

export async function getSettings(db: DbExecutor, userId: string): Promise<z.infer<typeof settingsResponseSchema>> {
  const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
  return {
    incomeBasis: row?.incomeBasis ?? 'recurring',
    fixedMonthlyIncome: row?.fixedMonthlyIncome ? normalizeMoney(row.fixedMonthlyIncome) : null,
    monthlyReserveAmount: normalizeMoney(row?.monthlyReserveAmount ?? '0'),
    includeGoalContributions: row?.includeGoalContributions ?? true,
    safetyMarginPercent: Number(row?.safetyMarginPercent ?? 0).toFixed(2),
  };
}

export const settingsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.authenticate);
  const tags = ['settings'];

  app.get('/', { schema: { tags, response: { 200: settingsResponseSchema } } }, async (request) =>
    getSettings(app.db, request.userId),
  );

  app.put(
    '/',
    { schema: { tags, body: settingsBodySchema, response: { 200: settingsResponseSchema } } },
    async (request) => {
      const merged = { ...(await getSettings(app.db, request.userId)), ...request.body };
      if (merged.incomeBasis === 'fixed' && !merged.fixedMonthlyIncome) {
        throw new AppError(422, 'BUSINESS_RULE', 'Informe fixedMonthlyIncome para usar a renda fixa');
      }
      const values = {
        incomeBasis: merged.incomeBasis,
        fixedMonthlyIncome: merged.fixedMonthlyIncome ? normalizeMoney(merged.fixedMonthlyIncome) : null,
        monthlyReserveAmount: normalizeMoney(merged.monthlyReserveAmount),
        includeGoalContributions: merged.includeGoalContributions,
        safetyMarginPercent: merged.safetyMarginPercent,
      };
      await app.db
        .insert(userSettings)
        .values({ userId: request.userId, ...values })
        .onConflictDoUpdate({ target: userSettings.userId, set: values });
      return getSettings(app.db, request.userId);
    },
  );
};
