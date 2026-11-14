import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { monthKey } from '../../domain/dates.js';
import { today } from '../../lib/clock.js';
import { isoDateSchema } from '../../shared/schemas.js';
import {
  balanceQuerySchema,
  balanceResponseSchema,
  categoriesQuerySchema,
  categoriesResponseSchema,
  dashboardSchema,
  forecastQuerySchema,
  forecastSchema,
  metricsSchema,
  monthQuerySchema,
  monthlyReportSchema,
  monthlySeriesSchema,
  rangeQuerySchema,
  recurringSpendSchema,
  safeToSpendSchema,
  weeklyReportSchema,
  yearlyReportSchema,
} from './analytics.schemas.js';
import { AnalyticsService } from './analytics.service.js';
import { safeToSpend } from './budget.js';
import { buildForecast } from './forecast.js';

/** /dashboard, /analytics/*, /reports/*, /metrics, /forecast, /safe-to-spend */
export const analyticsRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new AnalyticsService(app.db);
  app.addHook('onRequest', app.authenticate);

  app.get(
    '/dashboard',
    { schema: { tags: ['dashboard'], querystring: monthQuerySchema, response: { 200: dashboardSchema } } },
    async (request) => service.dashboard(request.userId, request.query.month),
  );

  app.get(
    '/analytics/monthly',
    { schema: { tags: ['analytics'], querystring: rangeQuerySchema, response: { 200: monthlySeriesSchema } } },
    async (request) => ({ data: await service.monthly(request.userId, request.query.from, request.query.to) }),
  );

  app.get(
    '/analytics/categories',
    { schema: { tags: ['analytics'], querystring: categoriesQuerySchema, response: { 200: categoriesResponseSchema } } },
    async (request) => {
      const q = request.query;
      return service.categories(request.userId, q.from, q.to, q.type, q.groupBy === 'parent');
    },
  );

  app.get(
    '/analytics/balance',
    { schema: { tags: ['analytics'], querystring: balanceQuerySchema, response: { 200: balanceResponseSchema } } },
    async (request) => ({ data: await service.balance(request.userId, request.query.from, request.query.to) }),
  );

  app.get(
    '/analytics/recurring',
    { schema: { tags: ['analytics'], response: { 200: recurringSpendSchema } } },
    async (request) => service.recurringSpend(request.userId),
  );

  app.get(
    '/reports/weekly',
    {
      schema: {
        tags: ['reports'],
        querystring: z.object({ date: isoDateSchema.optional() }),
        response: { 200: weeklyReportSchema },
      },
    },
    async (request) => service.weeklyReport(request.userId, request.query.date ?? today()),
  );

  app.get(
    '/reports/monthly',
    { schema: { tags: ['reports'], querystring: monthQuerySchema, response: { 200: monthlyReportSchema } } },
    async (request) => service.monthlyReport(request.userId, request.query.month ?? monthKey(today())),
  );

  app.get(
    '/reports/yearly',
    {
      schema: {
        tags: ['reports'],
        querystring: z.object({ year: z.coerce.number().int().min(2000).max(2200).optional() }),
        response: { 200: yearlyReportSchema },
      },
    },
    async (request) => service.yearlyReport(request.userId, request.query.year ?? Number(today().slice(0, 4))),
  );

  app.get(
    '/metrics',
    { schema: { tags: ['metrics'], querystring: monthQuerySchema, response: { 200: metricsSchema } } },
    async (request) => service.metrics(request.userId, request.query.month),
  );

  app.get(
    '/forecast',
    { schema: { tags: ['forecast'], querystring: forecastQuerySchema, response: { 200: forecastSchema } } },
    async (request) => buildForecast(app.db, request.userId, request.query),
  );

  app.get(
    '/safe-to-spend',
    { schema: { tags: ['safe-to-spend'], querystring: monthQuerySchema, response: { 200: safeToSpendSchema } } },
    async (request) => safeToSpend(app.db, request.userId, request.query.month),
  );
};
