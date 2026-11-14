/**
 * Pipeline de importação:
 *   arquivo → parser → NormalizedTransaction[] → detecção (duplicata / conciliação)
 *   → sugestão de categoria → PRÉVIA (import_rows) → confirmação do usuário → livro-caixa
 *
 * `ingest()` recebe transações já normalizadas: é a mesma porta que um provedor de
 * Open Finance usará (src/integrations/bank-sync) — nada aqui depende da origem.
 */
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { accounts, categoryRules, importBatches, importRows, transactions } from '../../db/schema.js';
import { addDays, diffDays } from '../../domain/dates.js';
import { computeFingerprint } from '../../lib/fingerprint.js';
import { fromCents, normalizeMoney, toCents } from '../../lib/money.js';
import { AppError, businessRule, notFound } from '../../shared/errors.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { CategoriesService } from '../categories/categories.service.js';
import { CompositeSuggester, findRule, suggestPattern, type CategorySuggester } from '../category-rules/categorizer.js';
import { postEntry } from '../ledger/posting.js';
import type { NormalizedTransaction } from './parsers/normalize.js';
import { parseOfx } from './parsers/ofx.js';
import { parseCsv, parseXlsx, type TabularOptions } from './parsers/tabular.js';

export type ImportSource = 'csv' | 'ofx' | 'xlsx' | 'open_finance';
type RowRow = typeof importRows.$inferSelect;
type BatchRow = typeof importBatches.$inferSelect;

/** Janela para conciliar com lançamentos pendentes (ex.: recorrência gerada no dia 5, banco debita dia 6). */
const RECONCILE_WINDOW_DAYS = 3;
/** Janela para "possível duplicata" (mesmo valor, descrição diferente). */
const POSSIBLE_DUPLICATE_WINDOW_DAYS = 2;
const MAX_ROWS = 5000;

export function detectSource(fileName: string, buffer: Buffer): Exclude<ImportSource, 'open_finance'> {
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'ofx' || ext === 'qfx') return 'ofx';
  if (ext === 'xlsx') return 'xlsx';
  if (ext === 'csv' || ext === 'txt') return 'csv';
  if (buffer.subarray(0, 2).toString('latin1') === 'PK') return 'xlsx';
  if (/<OFX>|OFXHEADER/i.test(buffer.subarray(0, 2000).toString('latin1'))) return 'ofx';
  return 'csv';
}

export class ImportsService {
  constructor(private readonly db: Database) {}

  // ─── 1. Upload de arquivo ──────────────────────────────────────────────────

  async previewFile(params: { userId: string; accountId: string; fileName: string; buffer: Buffer; options: TabularOptions }) {
    const account = await AccountsService.requireActiveAccount(this.db, params.userId, params.accountId);
    const source = detectSource(params.fileName, params.buffer);
    // Faturas de cartão em CSV/Excel listam compras como positivas: inverte por padrão.
    const options = { invertSign: account.type === 'credit_card' && source !== 'ofx', ...params.options };

    let parsed;
    try {
      parsed =
        source === 'ofx' ? parseOfx(params.buffer) : source === 'xlsx' ? await parseXlsx(params.buffer, options) : parseCsv(params.buffer, options);
    } catch (err) {
      throw new AppError(422, 'BUSINESS_RULE', `Não foi possível ler o arquivo: ${(err as Error).message}`);
    }

    const fileHash = createHash('sha256').update(params.buffer).digest('hex');
    const [previous] = await this.db
      .select({ id: importBatches.id, createdAt: importBatches.createdAt })
      .from(importBatches)
      .where(and(eq(importBatches.userId, params.userId), eq(importBatches.accountId, account.id), eq(importBatches.fileHash, fileHash), eq(importBatches.status, 'confirmed')))
      .limit(1);
    const warnings = [...parsed.warnings];
    if (previous) warnings.unshift('Este mesmo arquivo já foi importado antes nesta conta — as transações aparecerão como duplicadas.');

    return this.ingest({ userId: params.userId, accountId: account.id, source, fileName: params.fileName, fileHash, rows: parsed.rows, warnings });
  }

  // ─── 2. Ingestão de transações normalizadas (arquivo OU Open Finance) ─────

  async ingest(params: {
    userId: string;
    accountId: string;
    source: ImportSource;
    rows: NormalizedTransaction[];
    fileName?: string;
    fileHash?: string;
    warnings?: string[];
    suggester?: CategorySuggester;
  }) {
    if (params.rows.length === 0) throw businessRule('Nenhuma transação válida encontrada', { warnings: params.warnings ?? [] });
    if (params.rows.length > MAX_ROWS) throw businessRule(`Máximo de ${MAX_ROWS} transações por importação`);
    const account = await AccountsService.requireActiveAccount(this.db, params.userId, params.accountId);
    const suggester = params.suggester ?? (await CompositeSuggester.forUser(this.db, params.userId));

    const dates = params.rows.map((r) => r.date).sort();
    const windowFrom = addDays(dates[0]!, -RECONCILE_WINDOW_DAYS);
    const windowTo = addDays(dates.at(-1)!, RECONCILE_WINDOW_DAYS);
    const existing = await this.db
      .select()
      .from(transactions)
      .where(and(eq(transactions.accountId, account.id), gte(transactions.date, windowFrom), lte(transactions.date, windowTo)));
    const fitIds = params.rows.map((r) => r.fitId).filter((f): f is string => Boolean(f));
    const byFitId = new Map(
      (fitIds.length
        ? await this.db
            .select({ id: transactions.id, fitId: transactions.fitId })
            .from(transactions)
            .where(and(eq(transactions.accountId, account.id), inArray(transactions.fitId, fitIds)))
        : []
      ).map((t) => [t.fitId!, t.id]),
    );
    const byFingerprint = new Map(existing.map((t) => [t.fingerprint, t]));
    const claimed = new Set<string>(); // cada lançamento existente só casa com UMA linha
    const occurrences = new Map<string, number>();

    const prepared = params.rows.map((row, rowIndex) => {
      const base = `${row.date}|${row.amount}|${row.description}`;
      const occurrence = occurrences.get(base) ?? 0;
      occurrences.set(base, occurrence + 1);
      const fingerprint = computeFingerprint({ accountId: account.id, date: row.date, amount: row.amount, rawDescription: row.description, occurrence });
      const cents = toCents(row.amount);
      const type = cents > 0n ? ('income' as const) : ('expense' as const);

      let detection: RowRow['detection'] = 'new';
      let matched: string | null = null;

      const fitMatch = row.fitId ? byFitId.get(row.fitId) : undefined;
      const fpMatch = byFingerprint.get(fingerprint);
      if (fitMatch || fpMatch) {
        detection = 'duplicate';
        matched = fitMatch ?? fpMatch!.id;
      } else {
        const sameAmount = existing.filter((t) => t.status !== 'cancelled' && !claimed.has(t.id) && toCents(normalizeMoney(t.amount)) === cents);
        const pending = sameAmount
          .filter((t) => t.status === 'pending' && Math.abs(diffDays(t.date, row.date)) <= RECONCILE_WINDOW_DAYS)
          .sort((a, b) => Math.abs(diffDays(a.date, row.date)) - Math.abs(diffDays(b.date, row.date)))[0];
        const close = sameAmount.find(
          (t) => t.status === 'completed' && !t.fitId && Math.abs(diffDays(t.date, row.date)) <= POSSIBLE_DUPLICATE_WINDOW_DAYS,
        );
        if (pending) {
          detection = 'reconcile';
          matched = pending.id;
        } else if (close) {
          detection = 'possible_duplicate';
          matched = close.id;
        }
      }
      if (matched) claimed.add(matched);

      const suggestion = detection === 'duplicate' ? null : suggester.suggest({ description: row.description, accountId: account.id, type });
      const action: RowRow['action'] = detection === 'new' ? 'import' : detection === 'reconcile' ? 'reconcile' : 'skip';

      return {
        rowIndex,
        date: row.date,
        amount: row.amount,
        description: row.description,
        rawDescription: row.description,
        fitId: row.fitId ?? null,
        fingerprint,
        detection,
        matchedTransactionId: matched,
        suggestedCategoryId: suggestion?.categoryId ?? null,
        suggestionSource: suggestion?.source ?? ('none' as const),
        matchedRuleId: suggestion?.ruleId ?? null,
        categoryId: suggestion?.categoryId ?? null,
        action,
      };
    });

    const batchId = await this.db.transaction(async (tx) => {
      const [batch] = await tx
        .insert(importBatches)
        .values({
          userId: params.userId,
          accountId: account.id,
          source: params.source,
          fileName: params.fileName ?? null,
          fileHash: params.fileHash ?? null,
          rowCount: prepared.length,
        })
        .returning();
      for (let i = 0; i < prepared.length; i += 500) {
        await tx.insert(importRows).values(prepared.slice(i, i + 500).map((r) => ({ ...r, batchId: batch!.id })));
      }
      return batch!.id;
    });

    return { ...(await this.get(params.userId, batchId)), warnings: params.warnings ?? [] };
  }

  // ─── 3. Revisão ────────────────────────────────────────────────────────────

  async list(userId: string) {
    const rows = await this.db
      .select({ batch: importBatches, accountName: accounts.name })
      .from(importBatches)
      .innerJoin(accounts, eq(accounts.id, importBatches.accountId))
      .where(eq(importBatches.userId, userId))
      .orderBy(desc(importBatches.createdAt))
      .limit(100);
    return rows.map((r) => toBatchResponse(r.batch, r.accountName));
  }

  async get(userId: string, batchId: string) {
    const { batch, accountName } = await this.findBatch(userId, batchId);
    const rows = await this.db.select().from(importRows).where(eq(importRows.batchId, batchId)).orderBy(asc(importRows.rowIndex));
    return { ...toBatchResponse(batch, accountName), rows: rows.map(toRowResponse), summary: summarize(rows) };
  }

  async updateRow(userId: string, batchId: string, rowId: string, input: { action?: RowRow['action']; categoryId?: string | null; description?: string }) {
    const { batch } = await this.findBatch(userId, batchId);
    if (batch.status !== 'preview') throw businessRule('Importação já finalizada');
    const [row] = await this.db.select().from(importRows).where(and(eq(importRows.id, rowId), eq(importRows.batchId, batchId)));
    if (!row) throw notFound('Linha da importação');
    if (input.action === 'reconcile' && row.detection !== 'reconcile') {
      throw businessRule('Só é possível conciliar linhas que casaram com um lançamento pendente');
    }
    if (input.categoryId) {
      await CategoriesService.requireUsableCategory(this.db, userId, input.categoryId, toCents(row.amount) > 0n ? 'income' : 'expense');
    }
    await this.db.update(importRows).set(input).where(eq(importRows.id, rowId));
    const [updated] = await this.db.select().from(importRows).where(eq(importRows.id, rowId));
    return toRowResponse(updated!);
  }

  async discard(userId: string, batchId: string) {
    const { batch } = await this.findBatch(userId, batchId);
    if (batch.status !== 'preview') throw businessRule('Só é possível descartar importações em prévia');
    await this.db.update(importBatches).set({ status: 'discarded' }).where(eq(importBatches.id, batchId));
  }

  // ─── 4. Confirmação ────────────────────────────────────────────────────────

  /**
   * Grava no livro-caixa de forma atômica. `learnRules`: quando o usuário escolheu uma
   * categoria diferente da sugerida (ou não havia sugestão), cria uma regra "contém"
   * para que as próximas importações já venham categorizadas.
   */
  async confirm(userId: string, batchId: string, learnRules: boolean) {
    const result = await this.db.transaction(async (tx) => {
      const [batch] = await tx
        .select()
        .from(importBatches)
        .where(and(eq(importBatches.id, batchId), eq(importBatches.userId, userId)))
        .for('update');
      if (!batch) throw notFound('Importação');
      if (batch.status !== 'preview') throw businessRule('Importação já finalizada');
      const account = await AccountsService.requireActiveAccount(tx, userId, batch.accountId);
      const source = batch.source === 'csv' ? 'import_csv' : batch.source === 'ofx' ? 'import_ofx' : batch.source === 'xlsx' ? 'import_xlsx' : 'open_finance';

      const rows = await tx.select().from(importRows).where(eq(importRows.batchId, batchId)).orderBy(asc(importRows.rowIndex));
      const fitIds = rows.filter((r) => r.action !== 'skip' && r.fitId).map((r) => r.fitId!);
      const takenFitIds = new Set(
        (fitIds.length
          ? await tx.select({ f: transactions.fitId }).from(transactions).where(and(eq(transactions.accountId, account.id), inArray(transactions.fitId, fitIds)))
          : []
        ).map((t) => t.f),
      );

      let imported = 0;
      let reconciled = 0;
      let skipped = 0;
      let rulesCreated = 0;

      for (const row of rows) {
        if (row.action === 'skip' || (row.fitId && takenFitIds.has(row.fitId))) {
          skipped++;
          continue;
        }
        if (row.action === 'reconcile' && row.matchedTransactionId) {
          const [target] = await tx.select().from(transactions).where(eq(transactions.id, row.matchedTransactionId)).for('update');
          if (target && target.status === 'pending') {
            await tx
              .update(transactions)
              .set({
                status: 'completed',
                // Data real do banco (exceto cartão, onde a data define a fatura).
                ...(account.type !== 'credit_card' && { date: row.date }),
                ...(row.fitId && { fitId: row.fitId }),
                ...(!target.categoryId && row.categoryId && { categoryId: row.categoryId }),
              })
              .where(eq(transactions.id, target.id));
            await tx.update(importRows).set({ transactionId: target.id }).where(eq(importRows.id, row.id));
            reconciled++;
            continue;
          }
          // Se o pendente sumiu (cancelado/confirmado), importa normalmente.
        }

        const cents = toCents(normalizeMoney(row.amount));
        const created = await postEntry(tx, {
          userId,
          account,
          type: cents > 0n ? 'income' : 'expense',
          amount: fromCents(cents < 0n ? -cents : cents),
          date: row.date,
          description: row.description,
          rawDescription: row.rawDescription,
          categoryId: row.categoryId,
          status: 'completed',
          source,
          fitId: row.fitId,
          allowDuplicate: true, // duplicatas exatas já foram marcadas como "skip" na prévia
        });
        if (row.fitId) takenFitIds.add(row.fitId);
        await tx.update(importRows).set({ transactionId: created.id }).where(eq(importRows.id, row.id));
        imported++;

        if (learnRules && row.categoryId && row.categoryId !== row.suggestedCategoryId) {
          const pattern = suggestPattern(row.rawDescription);
          if (pattern.length >= 3 && !(await findRule(tx, userId, 'contains', pattern, null))) {
            await tx.insert(categoryRules).values({ userId, categoryId: row.categoryId, matchType: 'contains', pattern });
            rulesCreated++;
          }
        }
      }

      await tx
        .update(importBatches)
        .set({ status: 'confirmed', confirmedAt: new Date(), importedCount: imported, reconciledCount: reconciled, skippedCount: skipped })
        .where(eq(importBatches.id, batchId));
      return { imported, reconciled, skipped, rulesCreated };
    });
    return { ...result, batch: await this.get(userId, batchId) };
  }

  private async findBatch(userId: string, batchId: string) {
    const [r] = await this.db
      .select({ batch: importBatches, accountName: accounts.name })
      .from(importBatches)
      .innerJoin(accounts, eq(accounts.id, importBatches.accountId))
      .where(and(eq(importBatches.id, batchId), eq(importBatches.userId, userId)));
    if (!r) throw notFound('Importação');
    return r;
  }
}

function summarize(rows: RowRow[]) {
  const count = (pred: (r: RowRow) => boolean) => rows.filter(pred).length;
  return {
    new: count((r) => r.detection === 'new'),
    duplicate: count((r) => r.detection === 'duplicate'),
    possibleDuplicate: count((r) => r.detection === 'possible_duplicate'),
    reconcile: count((r) => r.detection === 'reconcile'),
    categorized: count((r) => r.categoryId !== null),
    toImport: count((r) => r.action === 'import'),
    toReconcile: count((r) => r.action === 'reconcile'),
    toSkip: count((r) => r.action === 'skip'),
  };
}

function toBatchResponse(b: BatchRow, accountName: string) {
  return {
    id: b.id,
    accountId: b.accountId,
    accountName,
    source: b.source,
    fileName: b.fileName,
    status: b.status,
    rowCount: b.rowCount,
    importedCount: b.importedCount,
    reconciledCount: b.reconciledCount,
    skippedCount: b.skippedCount,
    createdAt: b.createdAt.toISOString(),
    confirmedAt: b.confirmedAt?.toISOString() ?? null,
  };
}

function toRowResponse(r: RowRow) {
  return {
    id: r.id,
    rowIndex: r.rowIndex,
    date: r.date,
    amount: normalizeMoney(r.amount),
    description: r.description,
    rawDescription: r.rawDescription,
    fitId: r.fitId,
    detection: r.detection,
    matchedTransactionId: r.matchedTransactionId,
    suggestedCategoryId: r.suggestedCategoryId,
    suggestionSource: r.suggestionSource,
    categoryId: r.categoryId,
    action: r.action,
    transactionId: r.transactionId,
  };
}
