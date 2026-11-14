import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorResponseSchema, idParamsSchema } from '../../shared/schemas.js';
import {
  accountListResponseSchema,
  accountResponseSchema,
  createAccountBodySchema,
  listAccountsQuerySchema,
  updateAccountBodySchema,
} from './accounts.schemas.js';
import { AccountsService } from './accounts.service.js';

export const accountsRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new AccountsService(app.db);
  app.addHook('onRequest', app.authenticate);

  app.post(
    '/',
    {
      schema: {
        tags: ['accounts'],
        body: createAccountBodySchema,
        response: { 201: accountResponseSchema, 409: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const account = await service.create(request.userId, request.body);
      return reply.status(201).send(account);
    },
  );

  app.get(
    '/',
    {
      schema: {
        tags: ['accounts'],
        querystring: listAccountsQuerySchema,
        response: { 200: accountListResponseSchema },
      },
    },
    async (request) => service.list(request.userId, request.query),
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['accounts'],
        params: idParamsSchema,
        response: { 200: accountResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request) => service.getById(request.userId, request.params.id),
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags: ['accounts'],
        params: idParamsSchema,
        body: updateAccountBodySchema,
        response: { 200: accountResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request) => service.update(request.userId, request.params.id, request.body),
  );

  app.delete(
    '/:id',
    {
      schema: {
        tags: ['accounts'],
        params: idParamsSchema,
        response: { 204: z.null(), 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      await service.archive(request.userId, request.params.id);
      return reply.status(204).send(null);
    },
  );
};
