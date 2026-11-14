import type { FastifyError, FastifyInstance } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import {
  AppError,
  PG_CHECK_VIOLATION,
  PG_FOREIGN_KEY_VIOLATION,
  PG_UNIQUE_VIOLATION,
  getPgError,
} from '../shared/errors.js';

/** Formato único de erro: { error: { code, message, details? } } */
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError, request, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({
        error: { code: err.code, message: err.message, details: err.details },
      });
    }

    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Requisição inválida',
          details: {
            location: err.validationContext,
            issues: err.validation.map((issue) => ({
              path: issue.instancePath.replace(/^\//, '').replaceAll('/', '.'),
              message: issue.message,
            })),
          },
        },
      });
    }

    if (isResponseSerializationError(err)) {
      request.log.error({ err, issues: err.cause.issues }, 'Resposta não bate com o schema');
      return reply
        .status(500)
        .send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno de serialização' } });
    }

    // Constraints do banco: última linha de defesa da integridade.
    const pgError = getPgError(err);
    if (pgError?.code === PG_UNIQUE_VIOLATION) {
      return reply.status(409).send({
        error: {
          code: 'CONFLICT',
          message: 'Registro duplicado',
          details: { constraint: pgError.constraint },
        },
      });
    }
    if (pgError?.code === PG_FOREIGN_KEY_VIOLATION || pgError?.code === PG_CHECK_VIOLATION) {
      request.log.warn({ err }, 'Violação de integridade no banco');
      return reply.status(422).send({
        error: {
          code: 'BUSINESS_RULE',
          message: 'Operação viola uma regra de integridade dos dados',
          details: { constraint: pgError.constraint },
        },
      });
    }

    // Erros do próprio Fastify (ex.: JSON malformado, rate limit) mantêm o status original.
    if (err.statusCode && err.statusCode < 500) {
      return reply.status(err.statusCode).send({
        error: { code: err.code ?? 'BAD_REQUEST', message: err.message },
      });
    }

    request.log.error({ err }, 'Erro não tratado');
    return reply
      .status(500)
      .send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno inesperado' } });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      error: { code: 'NOT_FOUND', message: `Rota ${request.method} ${request.url} não existe` },
    }),
  );
}
