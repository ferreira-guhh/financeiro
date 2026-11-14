import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { z } from 'zod';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Env } from './config/env.js';
import { accountsRoutes } from './modules/accounts/accounts.routes.js';
import { analyticsRoutes } from './modules/analytics/analytics.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { categoriesRoutes } from './modules/categories/categories.routes.js';
import { categoryRulesRoutes } from './modules/category-rules/category-rules.module.js';
import { importsRoutes } from './modules/imports/imports.routes.js';
import { creditCardsRoutes } from './modules/credit-cards/credit-cards.routes.js';
import { goalsRoutes } from './modules/goals/goals.routes.js';
import { installmentPlansRoutes } from './modules/installment-plans/installment-plans.routes.js';
import { investmentsRoutes } from './modules/investments/investments.module.js';
import { processingRoutes } from './modules/processing/processing.module.js';
import { recurringRoutes } from './modules/recurring/recurring.routes.js';
import { settingsRoutes } from './modules/settings/settings.module.js';
import { simulationsRoutes } from './modules/simulations/simulations.module.js';
import { transactionsRoutes, transfersRoutes } from './modules/transactions/transactions.routes.js';
import { auditPlugin, listAuditLogs } from './plugins/audit.js';
import { authPlugin } from './plugins/auth.js';
import { databasePlugin } from './plugins/database.js';
import { registerErrorHandler } from './plugins/error-handler.js';

// Mensagens padrão do Zod em português.
z.config(z.locales.pt());

export async function buildApp(env: Env) {
  const app = Fastify({
    // Em produção (Render) a API fica atrás de um proxy: sem isso, o limite de
    // tentativas de login contaria todos os usuários como um único IP.
    trustProxy: env.NODE_ENV === 'production',
    logger:
      env.NODE_ENV === 'test'
        ? false
        : {
            level: env.NODE_ENV === 'production' ? 'info' : 'debug',
            redact: ['req.headers.authorization', 'body.password'],
          },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);

  await app.register(helmet);
  await app.register(cors, { origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()) });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 10 } });
  await app.register(databasePlugin, { connectionString: env.DATABASE_URL });
  await app.register(authPlugin, { secret: env.JWT_SECRET, expiresIn: env.JWT_EXPIRES_IN });
  await app.register(auditPlugin);

  app.get('/health', async () => ({ status: 'ok' }));

  await app.register(
    async (api) => {
      await api.register(authRoutes, {
        prefix: '/auth',
        rateLimitPerMinute: env.AUTH_RATE_LIMIT_PER_MINUTE,
      });
      await api.register(accountsRoutes, { prefix: '/accounts' });
      await api.register(categoriesRoutes, { prefix: '/categories' });
      await api.register(transactionsRoutes, { prefix: '/transactions' });
      await api.register(transfersRoutes, { prefix: '/transfers' });
      await api.register(creditCardsRoutes, { prefix: '/credit-cards' });
      await api.register(installmentPlansRoutes, { prefix: '/installment-plans' });
      await api.register(recurringRoutes, { prefix: '/recurring' });
      await api.register(goalsRoutes, { prefix: '/goals' });
      await api.register(investmentsRoutes, { prefix: '/investments' });
      await api.register(settingsRoutes, { prefix: '/settings' });
      await api.register(processingRoutes, { prefix: '/processing' });
      await api.register(analyticsRoutes);
      await api.register(simulationsRoutes, { prefix: '/simulations' });
      await api.register(categoryRulesRoutes, { prefix: '/category-rules' });
      await api.register(importsRoutes, { prefix: '/imports' });
      api.withTypeProvider<ZodTypeProvider>().get(
        '/audit-logs',
        {
          onRequest: [api.authenticate],
          schema: {
            tags: ['audit'],
            querystring: z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }),
          },
        },
        async (request) => ({ data: await listAuditLogs(app, request.userId, request.query.limit) }),
      );
    },
    { prefix: '/api/v1' },
  );

  return app;
}
