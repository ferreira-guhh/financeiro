/**
 * Sincronização de uma conta via Open Finance reutilizando o pipeline de importação.
 * O resultado é uma PRÉVIA (import_batch) — o usuário confirma como num upload de arquivo.
 */
import type { Database } from '../../db/client.js';
import { ImportsService } from '../../modules/imports/imports.service.js';
import { providerRegistry, type BankConnection } from './provider.js';

export async function syncAccount(
  db: Database,
  params: { userId: string; accountId: string; connection: BankConnection; externalAccountId: string; from: string; to: string },
) {
  const provider = providerRegistry.get(params.connection.provider);
  const rows = await provider.fetchTransactions(params.connection, params.externalAccountId, params.from, params.to);
  return new ImportsService(db).ingest({ userId: params.userId, accountId: params.accountId, source: 'open_finance', rows });
}
