export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DUPLICATE_TRANSACTION'
  | 'BUSINESS_RULE'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (entity: string) => new AppError(404, 'NOT_FOUND', `${entity} não encontrado(a)`);

export const businessRule = (message: string, details?: Record<string, unknown>) =>
  new AppError(422, 'BUSINESS_RULE', message, details);

export const conflict = (message: string, details?: Record<string, unknown>) =>
  new AppError(409, 'CONFLICT', message, details);

/** Extrai o erro do driver pg, mesmo quando o Drizzle o embrulha em `cause`. */
export function getPgError(err: unknown): { code?: string; constraint?: string } | undefined {
  let current: unknown = err;
  for (let i = 0; i < 3 && current && typeof current === 'object'; i++) {
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code)) {
      return {
        code: candidate.code,
        constraint: typeof candidate.constraint === 'string' ? candidate.constraint : undefined,
      };
    }
    current = candidate.cause;
  }
  return undefined;
}

export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';
export const PG_CHECK_VIOLATION = '23514';
