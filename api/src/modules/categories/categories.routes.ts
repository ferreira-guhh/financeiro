import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorResponseSchema } from '../../shared/schemas.js';
import {
  categoryResponseSchema,
  createCategoryBodySchema,
  listCategoriesQuerySchema,
} from './categories.schemas.js';
import { CategoriesService } from './categories.service.js';

export const categoriesRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new CategoriesService(app.db);
  app.addHook('onRequest', app.authenticate);

  app.get(
    '/',
    {
      schema: {
        tags: ['categories'],
        querystring: listCategoriesQuerySchema,
        response: { 200: z.object({ data: z.array(categoryResponseSchema) }) },
      },
    },
    async (request) => ({ data: await service.list(request.userId, request.query) }),
  );

  app.post(
    '/',
    {
      schema: {
        tags: ['categories'],
        body: createCategoryBodySchema,
        response: { 201: categoryResponseSchema, 409: errorResponseSchema, 422: errorResponseSchema },
      },
    },
    async (request, reply) =>
      reply.status(201).send(await service.create(request.userId, request.body)),
  );
};
