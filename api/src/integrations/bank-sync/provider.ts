/**
 * FASE 7 (futuro) — Camada genérica de Open Finance.
 *
 * Arquitetura (do planejamento):
 *   Banco → Open Finance → [BankSyncProvider] → Normalização → Categorização → PostgreSQL
 *
 * Esta pasta define APENAS o contrato. Nenhum provedor está implementado ainda,
 * por decisão do planejamento ("não implementar integração bancária antes de o
 * núcleo financeiro estar estável").
 *
 * Para integrar Pluggy, Belvo etc.:
 *   1. Implemente `BankSyncProvider` (ex.: `pluggy.provider.ts`) traduzindo a API para
 *      `NormalizedTransaction` — o MESMO formato usado por CSV/OFX/Excel.
 *   2. Registre no `providerRegistry`.
 *   3. Chame `syncAccount()`: ele reutiliza o pipeline de importação (duplicidades,
 *      conciliação, categorização, prévia e confirmação). Nada do núcleo muda.
 *
 * Segurança: nunca armazenar senhas ou credenciais bancárias. Guarde apenas o
 * identificador de conexão emitido pelo agregador (item/link id), criptografado.
 */
import type { NormalizedTransaction } from '../../modules/imports/parsers/normalize.js';

export interface ProviderAccount {
  /** Id da conta no provedor. */
  externalId: string;
  name: string;
  type: 'checking' | 'savings' | 'credit_card' | 'investment' | 'other';
  currency: string;
  /** Saldo informado pelo banco (string decimal), para conferência. */
  balance?: string;
}

export interface BankConnection {
  provider: string;
  /** Id da conexão/consentimento emitido pelo agregador (NUNCA a senha do banco). */
  connectionId: string;
}

export interface BankSyncProvider {
  readonly id: string;
  readonly displayName: string;
  listAccounts(connection: BankConnection): Promise<ProviderAccount[]>;
  /** Transações já normalizadas: datas YYYY-MM-DD, valores assinados em string, fitId = id do provedor. */
  fetchTransactions(connection: BankConnection, externalAccountId: string, from: string, to: string): Promise<NormalizedTransaction[]>;
}

export class ProviderRegistry {
  private readonly providers = new Map<string, BankSyncProvider>();

  register(provider: BankSyncProvider) {
    this.providers.set(provider.id, provider);
  }

  get(id: string): BankSyncProvider {
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`Provedor de Open Finance não registrado: ${id}`);
    return provider;
  }

  list() {
    return [...this.providers.values()].map((p) => ({ id: p.id, displayName: p.displayName }));
  }
}

export const providerRegistry = new ProviderRegistry();
