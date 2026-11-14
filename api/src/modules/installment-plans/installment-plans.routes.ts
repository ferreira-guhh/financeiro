import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorResponseSchema, idParamsSchema } from '../../shared/schemas.js';
import {
  cancelInstallmentPlanQuerySchema,
  createInstallmentPlanBodySchema,
  installmentPlanResponseSchema,
  listInstallmentPlansQuerySchema,
  scheduleQuerySchema,
  scheduleResponseSchema,
} from './installment-plans.schemas.js';
import { InstallmentPlansService } from './installment-plans.service.js';

export const installmentPlansRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new InstallmentPlansService(app.db);
  app.addHook('onRequest', app.authenticate);
  const tags = ['installment-plans'];

  app.get(
    '/',
    {
      schema: {
        tags,
        querystring: listInstallmentPlansQuerySchema,
        response: { 200: z.object({ data: z.array(installmentPlanResponseSchema) }) },
      },
    },
    async (request) => ({ data: await service.list(request.userId, request.query) }),
  );

  app.get(
    '/schedule',
    { schema: { tags, querystring: scheduleQuerySchema, response: { 200: scheduleResponseSchema } } },
    async (request) => service.schedule(request.userId, request.query.months),
  );

  app.post(
    '/',
    {
      schema: {
        tags,
        body: createInstallmentPlanBodySchema,
        response: { 201: installmentPlanResponseSchema, 404: errorResponseSchema, 422: errorResponseSchema },
      },
    },
    async (request, reply) => reply.status(201).send(await service.create(request.userId, request.body)),
  );

  app.get(
    '/:id',
    {
      schema: {
        tags,
        params: idParamsSchema,
        response: { 200: installmentPlanResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request) => service.get(request.userId, request.params.id),
  );

  app.delete(
    '/:id',
    {
      schema: {
        tags,
        params: idParamsSchema,
        querystring: cancelInstallmentPlanQuerySchema,
        response: { 204: z.null(), 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      await service.cancel(request.userId, request.params.id, request.query.cancelPosted);
      return reply.status(204).send(null);
    },
  );
};
