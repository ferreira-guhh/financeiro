import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { importActionEnum, importBatchStatusEnum, importDetectionEnum, importSourceEnum, suggestionSourceEnum } from '../../db/schema.js';
import { AppError } from '../../shared/errors.js';
import { errorResponseSchema, idParamsSchema, isoDateSchema, signedMoneySchema, uuidSchema } from '../../shared/schemas.js';
import { ImportsService } from './imports.service.js';

const MAX_FILE_BYTES = 5 * 1024 * 1024;

const optionsSchema = z
  .object({
    delimiter: z.string().max(1).optional(),
    decimalSeparator: z.enum([',', '.']).optional(),
    dateFormat: z.enum(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']).optional(),
    invertSign: z.boolean().optional(),
    sheet: z.string().max(100).optional(),
    columns: z
      .object({
        date: z.union([z.string(), z.number().int().min(0)]),
        description: z.union([z.string(), z.number().int().min(0)]),
        amount: z.union([z.string(), z.number().int().min(0)]),
        debit: z.union([z.string(), z.number().int().min(0)]),
        credit: z.union([z.string(), z.number().int().min(0)]),
        fitId: z.union([z.string(), z.number().int().min(0)]),
      })
      .partial()
      .optional(),
  })
  .default({});

const batchSchema = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  accountName: z.string(),
  source: z.enum(importSourceEnum.enumValues),
  fileName: z.string().nullable(),
  status: z.enum(importBatchStatusEnum.enumValues),
  rowCount: z.number(),
  importedCount: z.number(),
  reconciledCount: z.number(),
  skippedCount: z.number(),
  createdAt: z.string(),
  confirmedAt: z.string().nullable(),
});

const rowSchema = z.object({
  id: z.uuid(),
  rowIndex: z.number(),
  date: z.string(),
  amount: z.string(),
  description: z.string(),
  rawDescription: z.string(),
  fitId: z.string().nullable(),
  detection: z.enum(importDetectionEnum.enumValues),
  matchedTransactionId: z.uuid().nullable(),
  suggestedCategoryId: z.uuid().nullable(),
  suggestionSource: z.enum(suggestionSourceEnum.enumValues),
  categoryId: z.uuid().nullable(),
  action: z.enum(importActionEnum.enumValues),
  transactionId: z.uuid().nullable(),
});

const batchDetailSchema = batchSchema.extend({
  rows: z.array(rowSchema),
  summary: z.object({
    new: z.number(),
    duplicate: z.number(),
    possibleDuplicate: z.number(),
    reconcile: z.number(),
    categorized: z.number(),
    toImport: z.number(),
    toReconcile: z.number(),
    toSkip: z.number(),
  }),
  warnings: z.array(z.string()).optional(),
});

const errors = { 400: errorResponseSchema, 404: errorResponseSchema, 422: errorResponseSchema };

export const importsRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = new ImportsService(app.db);
  app.addHook('onRequest', app.authenticate);
  const tags = ['imports'];

  /**
   * Upload multipart: campos `accountId`, `options` (JSON opcional) e `file` (.csv, .ofx, .xlsx).
   * Devolve a PRÉVIA — nada entra no livro-caixa até POST /imports/:id/confirm.
   */
  app.post('/', { schema: { tags, consumes: ['multipart/form-data'], response: { 201: batchDetailSchema, ...errors } } }, async (request, reply) => {
    if (!request.isMultipart()) throw new AppError(400, 'VALIDATION_ERROR', 'Envie multipart/form-data com o arquivo');
    const fields: Record<string, string> = {};
    let file: { name: string; buffer: Buffer } | null = null;
    for await (const part of request.parts({ limits: { fileSize: MAX_FILE_BYTES, files: 1 } })) {
      if (part.type === 'file') {
        const buffer = await part.toBuffer();
        if (part.file.truncated) throw new AppError(400, 'VALIDATION_ERROR', 'Arquivo maior que 5 MB');
        file = { name: part.filename, buffer };
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }
    if (!file) throw new AppError(400, 'VALIDATION_ERROR', 'Arquivo não enviado (campo "file")');
    const accountId = uuidSchema.safeParse(fields.accountId);
    if (!accountId.success) throw new AppError(400, 'VALIDATION_ERROR', 'accountId inválido');
    let options;
    try {
      options = optionsSchema.parse(fields.options ? JSON.parse(fields.options) : {});
    } catch {
      throw new AppError(400, 'VALIDATION_ERROR', 'options deve ser um JSON válido');
    }
    const preview = await service.previewFile({ userId: request.userId, accountId: accountId.data, fileName: file.name, buffer: file.buffer, options });
    return reply.status(201).send(preview);
  });

  /** Transações já normalizadas (scripts próprios, Open Finance, testes). */
  app.post(
    '/normalized',
    {
      schema: {
        tags,
        body: z.object({
          accountId: uuidSchema,
          transactions: z
            .array(
              z.object({
                date: isoDateSchema,
                amount: signedMoneySchema.refine((v) => !/^-?0+(\.0+)?$/.test(v), 'Valor não pode ser zero'),
                description: z.string().trim().min(1).max(255),
                fitId: z.string().trim().max(255).optional(),
              }),
            )
            .min(1)
            .max(5000),
        }),
        response: { 201: batchDetailSchema, ...errors },
      },
    },
    async (request, reply) =>
      reply.status(201).send(
        await service.ingest({ userId: request.userId, accountId: request.body.accountId, source: 'open_finance', rows: request.body.transactions }),
      ),
  );

  app.get('/', { schema: { tags, response: { 200: z.object({ data: z.array(batchSchema) }) } } }, async (request) => ({
    data: await service.list(request.userId),
  }));

  app.get(
    '/:id',
    { schema: { tags, params: idParamsSchema, response: { 200: batchDetailSchema, ...errors } } },
    async (request) => service.get(request.userId, request.params.id),
  );

  app.patch(
    '/:id/rows/:rowId',
    {
      schema: {
        tags,
        params: z.object({ id: uuidSchema, rowId: uuidSchema }),
        body: z
          .object({
            action: z.enum(importActionEnum.enumValues),
            categoryId: uuidSchema.nullable(),
            description: z.string().trim().min(1).max(255),
          })
          .partial()
          .refine((b) => Object.keys(b).length > 0, 'Envie ao menos um campo'),
        response: { 200: rowSchema, ...errors },
      },
    },
    async (request) => service.updateRow(request.userId, request.params.id, request.params.rowId, request.body),
  );

  app.post(
    '/:id/confirm',
    {
      schema: {
        tags,
        params: idParamsSchema,
        body: z.object({ learnRules: z.boolean().default(true) }).default({ learnRules: true }),
        response: {
          200: z.object({ imported: z.number(), reconciled: z.number(), skipped: z.number(), rulesCreated: z.number(), batch: batchDetailSchema }),
          ...errors,
        },
      },
    },
    async (request) => service.confirm(request.userId, request.params.id, request.body.learnRules),
  );

  app.delete(
    '/:id',
    { schema: { tags, params: idParamsSchema, response: { 204: z.null(), ...errors } } },
    async (request, reply) => {
      await service.discard(request.userId, request.params.id);
      return reply.status(204).send(null);
    },
  );
};
