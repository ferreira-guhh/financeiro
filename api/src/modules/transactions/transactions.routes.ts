import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorResponseSchema, idParamsSchema } from '../../shared/schemas.js';
import {
  createTransactionBodySchema,
  createTransferBodySchema,
  listTransactionsQuerySchema,
  transactionListResponseSchema,
  transactionResponseSchema,
  transferResponseSchema,
  updateTransactionBodySchema,
} from './transactions.schemas.js';
import { TransactionsService } from './transactions.service.js';

const commonErrors = {
  400: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
  422: errorResponseSchema,
};

export const transactionsRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new TransactionsService(app.db);
  app.addHook('onRequest', app.authenticate);

  app.post(
    '/',
    {
      schema: {
        tags: ['transactions'],
        body: createTransactionBodySchema,
        response: { 201: transactionResponseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      reply.status(201).send(await service.create(request.userId, request.body)),
  );

  app.get(
    '/',
    {
      schema: {
        tags: ['transactions'],
        querystring: listTransactionsQuerySchema,
        response: { 200: transactionListResponseSchema },
      },
    },
    async (request) => service.list(request.userId, request.query),
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['transactions'],
        params: idParamsSchema,
        response: { 200: transactionResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request) => service.getById(request.userId, request.params.id),
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags: ['transactions'],
        params: idParamsSchema,
        body: updateTransactionBodySchema,
        response: { 200: transactionResponseSchema, ...commonErrors },
      },
    },
    async (request) => service.update(request.userId, request.params.id, request.body),
  );

  app.delete(
    '/:id',
    {
      schema: {
        tags: ['transactions'],
        params: idParamsSchema,
        response: { 204: z.null(), 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      await service.cancel(request.userId, request.params.id);
      return reply.status(204).send(null);
    },
  );
};

export const transfersRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new TransactionsService(app.db);
  app.addHook('onRequest', app.authenticate);

  app.post(
    '/',
    {
      schema: {
        tags: ['transfers'],
        body: createTransferBodySchema,
        response: { 201: transferResponseSchema, ...commonErrors },
      },
    },
    async (request, reply) =>
      reply.status(201).send(await service.createTransfer(request.userId, request.body)),
  );
};
