/**
 * Registro de operações importantes (segurança).
 *
 * Toda requisição autenticada que MODIFICA dados (POST/PUT/PATCH/DELETE) e termina com
 * sucesso gera uma linha em audit_logs, com rota, id da entidade, IP e user-agent.
 * Falhas de login também são registradas. O corpo da requisição NÃO é gravado
 * (evita guardar dados sensíveis no log).
 */
import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { auditLogs } from '../db/schema.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const UUID_RE = /"id":"([0-9a-f-]{36})"/;

function meta(request: FastifyRequest) {
  return {
    ip: request.ip?.slice(0, 64) ?? null,
    userAgent: (request.headers['user-agent'] ?? '').slice(0, 255) || null,
  };
}

export async function recordAudit(
  app: FastifyInstance,
  request: FastifyRequest,
  entry: { userId: string | null; action: string; entityId?: string | null; statusCode?: number; metadata?: Record<string, unknown> },
) {
  try {
    await app.db.insert(auditLogs).values({
      userId: entry.userId,
      action: entry.action.slice(0, 120),
      entityId: entry.entityId ?? null,
      statusCode: entry.statusCode ?? null,
      metadata: entry.metadata ?? null,
      ...meta(request),
    });
  } catch (err) {
    // Auditoria nunca derruba a operação principal.
    request.log.error({ err }, 'Falha ao gravar auditoria');
  }
}

export const auditPlugin = fp(
  async (app) => {
    app.addHook('onSend', async (request, reply, payload) => {
      const status = reply.statusCode;
      const route = request.routeOptions.url ?? request.url;
      if (MUTATING.has(request.method) && status < 400 && request.userId) {
        const params = (request.params ?? {}) as Record<string, string>;
        const fromBody = typeof payload === 'string' ? UUID_RE.exec(payload)?.[1] : undefined;
        await recordAudit(app, request, {
          userId: request.userId,
          action: `${request.method} ${route}`,
          entityId: params.id ?? fromBody ?? null,
          statusCode: status,
        });
      }
      // Cadastro e login bem-sucedidos: o usuário vem na resposta (ainda não há token na requisição).
      if ((route?.endsWith('/auth/login') || route?.endsWith('/auth/register')) && status < 400 && typeof payload === 'string') {
        const userId = /"user":\{"id":"([0-9a-f-]{36})"/.exec(payload)?.[1] ?? null;
        await recordAudit(app, request, { userId, action: `${request.method} ${route}`, entityId: userId, statusCode: status });
      }
      if (route?.endsWith('/auth/login') && status === 401) {
        await recordAudit(app, request, { userId: null, action: 'auth.login_failed', statusCode: status });
      }
      return payload;
    });
  },
  { name: 'audit', dependencies: ['database', 'auth'] },
);

export async function listAuditLogs(app: FastifyInstance, userId: string, limit: number) {
  const rows = await app.db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.userId, userId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    entityId: r.entityId,
    statusCode: r.statusCode,
    ip: r.ip,
    userAgent: r.userAgent,
    createdAt: r.createdAt.toISOString(),
  }));
}
