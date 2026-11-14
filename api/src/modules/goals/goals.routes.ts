import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorResponseSchema, idParamsSchema } from '../../shared/schemas.js';
import {
  contributionBodySchema,
  contributionResponseSchema,
  createGoalBodySchema,
  goalResponseSchema,
  projectionQuerySchema,
  projectionResponseSchema,
  updateGoalBodySchema,
} from './goals.schemas.js';
import { GoalsService } from './goals.service.js';

const errors = { 404: errorResponseSchema, 422: errorResponseSchema };

export const goalsRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new GoalsService(app.db);
  app.addHook('onRequest', app.authenticate);
  const tags = ['goals'];

  app.get(
    '/',
    {
      schema: {
        tags,
        querystring: z.object({
          includeInactive: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
        }),
        response: { 200: z.object({ data: z.array(goalResponseSchema) }) },
      },
    },
    async (request) => ({ data: await service.list(request.userId, request.query.includeInactive) }),
  );

  app.post(
    '/',
    { schema: { tags, body: createGoalBodySchema, response: { 201: goalResponseSchema, ...errors } } },
    async (request, reply) => reply.status(201).send(await service.create(request.userId, request.body)),
  );

  app.get(
    '/:id',
    { schema: { tags, params: idParamsSchema, response: { 200: goalResponseSchema, ...errors } } },
    async (request) => service.get(request.userId, request.params.id),
  );

  app.patch(
    '/:id',
    { schema: { tags, params: idParamsSchema, body: updateGoalBodySchema, response: { 200: goalResponseSchema, ...errors } } },
    async (request) => service.update(request.userId, request.params.id, request.body),
  );

  app.delete(
    '/:id',
    { schema: { tags, params: idParamsSchema, response: { 204: z.null(), ...errors } } },
    async (request, reply) => {
      await service.cancel(request.userId, request.params.id);
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/:id/contributions',
    { schema: { tags, params: idParamsSchema, response: { 200: z.object({ data: z.array(contributionResponseSchema) }), ...errors } } },
    async (request) => ({ data: await service.listContributions(request.userId, request.params.id) }),
  );

  app.post(
    '/:id/contributions',
    { schema: { tags, params: idParamsSchema, body: contributionBodySchema, response: { 201: goalResponseSchema, ...errors } } },
    async (request, reply) =>
      reply.status(201).send(await service.addContribution(request.userId, request.params.id, request.body)),
  );

  app.get(
    '/:id/projection',
    { schema: { tags, params: idParamsSchema, querystring: projectionQuerySchema, response: { 200: projectionResponseSchema, ...errors } } },
    async (request) => service.projection(request.userId, request.params.id, request.query),
  );
};
