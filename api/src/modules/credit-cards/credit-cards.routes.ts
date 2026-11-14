import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorResponseSchema, idParamsSchema } from '../../shared/schemas.js';
import { transactionResponseSchema } from '../transactions/transactions.schemas.js';
import {
  createCreditCardBodySchema,
  creditCardResponseSchema,
  invoiceDetailSchema,
  invoiceParamsSchema,
  invoiceSummarySchema,
  payInvoiceBodySchema,
  purchaseBodySchema,
  updateCreditCardBodySchema,
} from './credit-cards.schemas.js';
import { CreditCardsService } from './credit-cards.service.js';

const errors = { 400: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema, 422: errorResponseSchema };

export const creditCardsRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new CreditCardsService(app.db);
  app.addHook('onRequest', app.authenticate);
  const tags = ['credit-cards'];

  app.get(
    '/',
    {
      schema: {
        tags,
        querystring: z.object({
          includeInactive: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
        }),
        response: { 200: z.object({ data: z.array(creditCardResponseSchema) }) },
      },
    },
    async (request) => ({ data: await service.list(request.userId, request.query.includeInactive) }),
  );

  app.post(
    '/',
    { schema: { tags, body: createCreditCardBodySchema, response: { 201: creditCardResponseSchema, ...errors } } },
    async (request, reply) => reply.status(201).send(await service.create(request.userId, request.body)),
  );

  app.get(
    '/:id',
    { schema: { tags, params: idParamsSchema, response: { 200: creditCardResponseSchema, 404: errorResponseSchema } } },
    async (request) => service.get(request.userId, request.params.id),
  );

  app.patch(
    '/:id',
    {
      schema: { tags, params: idParamsSchema, body: updateCreditCardBodySchema, response: { 200: creditCardResponseSchema, ...errors } },
    },
    async (request) => service.update(request.userId, request.params.id, request.body),
  );

  app.delete(
    '/:id',
    { schema: { tags, params: idParamsSchema, response: { 204: z.null(), 404: errorResponseSchema } } },
    async (request, reply) => {
      await service.archive(request.userId, request.params.id);
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/:id/purchases',
    {
      schema: {
        tags,
        params: idParamsSchema,
        body: purchaseBodySchema,
        response: {
          201: z.object({
            kind: z.enum(['transaction', 'installment_plan']),
            transaction: transactionResponseSchema.nullable(),
            installmentPlanId: z.uuid().nullable(),
          }),
          ...errors,
        },
      },
    },
    async (request, reply) =>
      reply.status(201).send(await service.purchase(request.userId, request.params.id, request.body)),
  );

  app.get(
    '/:id/invoices',
    {
      schema: { tags, params: idParamsSchema, response: { 200: z.object({ data: z.array(invoiceSummarySchema) }) } },
    },
    async (request) => ({ data: await service.listInvoices(request.userId, request.params.id) }),
  );

  app.get(
    '/:id/invoices/:year/:month',
    { schema: { tags, params: invoiceParamsSchema, response: { 200: invoiceDetailSchema, 404: errorResponseSchema } } },
    async (request) =>
      service.invoiceDetail(request.userId, request.params.id, request.params.year, request.params.month),
  );

  app.post(
    '/:id/invoices/:year/:month/payments',
    {
      schema: { tags, params: invoiceParamsSchema, body: payInvoiceBodySchema, response: { 201: invoiceDetailSchema, ...errors } },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(
          await service.payInvoice(request.userId, request.params.id, request.params.year, request.params.month, request.body),
        ),
  );
};
