/**
 * Processamento idempotente: transforma projeções cujo dia chegou em lançamentos reais
 * (parcelas e recorrências). Pode rodar quantas vezes quiser — nunca duplica.
 *
 * Disparado: (1) pelo frontend ao abrir o app, (2) pelo agendador a cada hora (server.ts).
 */
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Database } from '../../db/client.js';
import { installmentPlans, recurringTransactions } from '../../db/schema.js';
import { today } from '../../lib/clock.js';
import { InstallmentPlansService } from '../installment-plans/installment-plans.service.js';
import { RecurringService } from '../recurring/recurring.service.js';

export interface ProcessingResult {
  asOf: string;
  installmentsPosted: number;
  recurringGenerated: number;
}

export async function processUser(db: Database, userId: string, asOf = today()): Promise<ProcessingResult> {
  const installmentsPosted = await InstallmentPlansService.materializeDueForUser(db, userId, asOf);
  const recurringGenerated = await RecurringService.materializeDueForUser(db, userId, asOf);
  return { asOf, installmentsPosted, recurringGenerated };
}

/** Usuários com algo a processar (planos ativos ou recorrências ativas). */
export async function processAllUsers(db: Database, asOf = today()) {
  const users = await db
    .selectDistinct({ userId: sql<string>`u.user_id` })
    .from(
      sql`(
        select ${installmentPlans.userId} as user_id from ${installmentPlans} where ${installmentPlans.status} = 'active'
        union
        select ${recurringTransactions.userId} from ${recurringTransactions} where ${recurringTransactions.isActive}
      ) as u`,
    );
  const results: ProcessingResult[] = [];
  for (const { userId } of users) results.push(await processUser(db, userId, asOf));
  return {
    users: users.length,
    installmentsPosted: results.reduce((a, r) => a + r.installmentsPosted, 0),
    recurringGenerated: results.reduce((a, r) => a + r.recurringGenerated, 0),
  };
}

export const processingRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.authenticate);
  app.post(
    '/run',
    {
      schema: {
        tags: ['processing'],
        response: {
          200: z.object({ asOf: z.string(), installmentsPosted: z.number(), recurringGenerated: z.number() }),
        },
      },
    },
    async (request) => processUser(app.db, request.userId),
  );
};
