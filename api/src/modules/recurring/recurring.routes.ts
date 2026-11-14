import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorResponseSchema, idParamsSchema } from '../../shared/schemas.js';
import {
  createRecurringBodySchema,
  recurringResponseSchema,
  suggestionSchema,
  upcomingItemSchema,
  upcomingQuerySchema,
  updateRecurringBodySchema,
} from './recurring.schemas.js';
import { RecurringService } from './recurring.service.js';

export const recurringRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new RecurringService(app.db);
  app.addHook('onRequest', app.authenticate);
  const tags = ['recurring'];

  app.get(
    '/',
    {
      schema: {
        tags,
        querystring: z.object({
          includeInactive: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
        }),
        response: { 200: z.object({ data: z.array(recurringResponseSchema) }) },
      },
    },
    async (request) => ({ data: await service.list(request.userId, request.query.includeInactive) }),
  );

  app.get(
    '/upcoming',
    {
      schema: {
        tags,
        querystring: upcomingQuerySchema,
        response: { 200: z.object({ data: z.array(upcomingItemSchema) }) },
      },
    },
    async (request) => ({ data: await service.upcoming(request.userId, request.query.days) }),
  );

  app.get(
    '/suggestions',
    { schema: { tags, response: { 200: z.object({ data: z.array(suggestionSchema) }) } } },
    async (request) => ({ data: await service.suggestions(request.userId) }),
  );

  app.post(
    '/',
    {
      schema: {
        tags,
        body: createRecurringBodySchema,
        response: { 201: recurringResponseSchema, 404: errorResponseSchema, 422: errorResponseSchema },
      },
    },
    async (request, reply) => reply.status(201).send(await service.create(request.userId, request.body)),
  );

  app.get(
    '/:id',
    { schema: { tags, params: idParamsSchema, response: { 200: recurringResponseSchema, 404: errorResponseSchema } } },
    async (request) => service.get(request.userId, request.params.id),
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags,
        params: idParamsSchema,
        body: updateRecurringBodySchema,
        response: { 200: recurringResponseSchema, 404: errorResponseSchema, 422: errorResponseSchema },
      },
    },
    async (request) => service.update(request.userId, request.params.id, request.body),
  );

  app.delete(
    '/:id',
    { schema: { tags, params: idParamsSchema, response: { 204: z.null(), 404: errorResponseSchema } } },
    async (request, reply) => {
      await service.deactivate(request.userId, request.params.id);
      return reply.status(204).send(null);
    },
  );
};
