import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, ilike, isNull, lte, ne, sql, type SQL } from 'drizzle-orm';
import type { Database, DbExecutor } from '../../db/client.js';
import { invoices, transactions } from '../../db/schema.js';
import { invoicePeriodForDate } from '../../domain/credit-card.js';
import { today } from '../../lib/clock.js';
import { fromCents, toCents } from '../../lib/money.js';
import { AppError, businessRule, notFound } from '../../shared/errors.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { resolvePaymentInvoiceId } from '../credit-cards/invoice-queries.js';
import {
  ensureInvoice,
  getCardByAccount,
  insertWithFingerprint,
  postEntry,
  signedAmount,
  type TransactionRow,
} from '../ledger/posting.js';
import { CategoriesService } from '../categories/categories.service.js';
import { autoCategoryId } from '../category-rules/categorizer.js';
import {
  toTransactionResponse,
  type CreateTransactionBody,
  type CreateTransferBody,
  type ListTransactionsQuery,
  type UpdateTransactionBody,
} from './transactions.schemas.js';

export class TransactionsService {
  constructor(private readonly db: Database) {}

  // ─── Criação ───────────────────────────────────────────────────────────────

  async create(userId: string, input: CreateTransactionBody) {
    const account = await AccountsService.requireActiveAccount(this.db, userId, input.accountId);
    if (account.type === 'credit_card') {
      throw businessRule('Compras no cartão são lançadas pelo módulo de cartões (faturas)');
    }
    if (input.categoryId) {
      await CategoriesService.requireUsableCategory(this.db, userId, input.categoryId, input.type);
    }
    const categoryId =
      input.categoryId ??
      (await autoCategoryId(this.db, userId, { description: input.rawDescription ?? input.description, accountId: account.id, type: input.type }));

    const row = await postEntry(this.db, {
      userId,
      account,
      type: input.type,
      amount: input.amount,
      date: input.date,
      description: input.description,
      rawDescription: input.rawDescription,
      categoryId,
      status: input.status,
      paymentMethod: input.paymentMethod,
      notes: input.notes,
      source: 'manual',
      allowDuplicate: input.allowDuplicate,
    });
    return toTransactionResponse(row);
  }

  /**
   * Transferência = duas pernas no livro-caixa (saída na origem, entrada no destino),
   * gravadas atomicamente e ligadas por `transferId`. A soma das pernas é sempre zero.
   */
  async createTransfer(userId: string, input: CreateTransferBody & { invoiceId?: string }) {
    return this.db.transaction(async (tx) => {
      const from = await AccountsService.requireActiveAccount(tx, userId, input.fromAccountId);
      const to = await AccountsService.requireActiveAccount(tx, userId, input.toAccountId);
      if (from.type === 'credit_card') {
        throw businessRule('Cartão de crédito não pode ser origem de transferência');
      }
      if (from.currency !== to.currency) {
        throw businessRule('Transferência entre moedas diferentes ainda não é suportada', {
          from: from.currency,
          to: to.currency,
        });
      }

      const transferId = randomUUID();
      const amountCents = toCents(input.amount);
      const base = {
        userId,
        type: 'transfer' as const,
        status: input.status,
        date: input.date,
        description: input.description,
        rawDescription: input.description,
        notes: input.notes ?? null,
        source: 'manual' as const,
        transferId,
      };

      const outLeg = await insertWithFingerprint(
        tx,
        { ...base, accountId: from.id, amount: fromCents(-amountCents) },
        input.allowDuplicate,
      );
      // Transferência PARA um cartão = pagamento de fatura: a perna do cartão é vinculada à fatura.
      let invoiceId: string | null = null;
      if (to.type === 'credit_card') {
        const card = await getCardByAccount(tx, to.id);
        invoiceId =
          input.invoiceId ??
          (await resolvePaymentInvoiceId(tx, card.id, input.date, () =>
            ensureInvoice(tx, card.id, invoicePeriodForDate(input.date, card)),
          ));
      }

      const inLeg = await insertWithFingerprint(
        tx,
        { ...base, accountId: to.id, amount: fromCents(amountCents), invoiceId },
        input.allowDuplicate,
      );

      return {
        transferId,
        from: toTransactionResponse(outLeg),
        to: toTransactionResponse(inLeg),
      };
    });
  }

  // ─── Leitura ───────────────────────────────────────────────────────────────

  async getById(userId: string, id: string) {
    return toTransactionResponse(await this.findOwned(this.db, userId, id));
  }

  async list(userId: string, query: ListTransactionsQuery) {
    const filters: (SQL | undefined)[] = [
      eq(transactions.userId, userId),
      query.accountId ? eq(transactions.accountId, query.accountId) : undefined,
      query.categoryId === 'none'
        ? isNull(transactions.categoryId)
        : query.categoryId
          ? eq(transactions.categoryId, query.categoryId)
          : undefined,
      query.type ? eq(transactions.type, query.type) : undefined,
      query.status ? eq(transactions.status, query.status) : ne(transactions.status, 'cancelled'),
      query.from ? gte(transactions.date, query.from) : undefined,
      query.to ? lte(transactions.date, query.to) : undefined,
      query.search ? ilike(transactions.description, `%${escapeLike(query.search)}%`) : undefined,
    ];

    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      // Paginação por keyset: estável mesmo com inserções concorrentes.
      filters.push(sql`(${transactions.date}, ${transactions.id}) < (${cursor.date}::date, ${cursor.id}::uuid)`);
    }

    const rows = await this.db
      .select()
      .from(transactions)
      .where(and(...filters))
      .orderBy(desc(transactions.date), desc(transactions.id))
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);

    return {
      data: page.map(toTransactionResponse),
      nextCursor: hasMore && last ? encodeCursor({ date: last.date, id: last.id }) : null,
    };
  }

  // ─── Atualização ───────────────────────────────────────────────────────────

  /**
   * O fingerprint NÃO é recalculado: ele identifica a origem do lançamento.
   * Se fosse recalculado, uma reimportação do mesmo extrato criaria duplicata.
   */
  async update(userId: string, id: string, input: UpdateTransactionBody) {
    return this.db.transaction(async (tx) => {
      const current = await this.findOwned(tx, userId, id, { forUpdate: true });

      if (current.status === 'cancelled') {
        throw businessRule('Transação cancelada não pode ser alterada');
      }

      if (current.source === 'installment' && (input.amount !== undefined || input.date !== undefined)) {
        throw businessRule('Valor e data de parcelas são definidos pelo parcelamento. Cancele o parcelamento para alterar.');
      }

      // Lançamento de cartão: só pode mudar valor/data enquanto a fatura (origem e destino) estiver aberta.
      let newInvoiceId: string | undefined;
      if (current.invoiceId && current.type !== 'transfer' && (input.amount !== undefined || input.date !== undefined)) {
        const now = today();
        const [inv] = await tx.select().from(invoices).where(eq(invoices.id, current.invoiceId)).limit(1);
        if (inv && now >= inv.closingDate) {
          throw businessRule('A fatura deste lançamento já fechou. Registre um estorno em vez de alterar.');
        }
        if (input.date !== undefined && input.date !== current.date) {
          const card = await getCardByAccount(tx, current.accountId);
          const period = invoicePeriodForDate(input.date, card);
          if (now >= period.closingDate) throw businessRule('A nova data cai em uma fatura já fechada.');
          newInvoiceId = await ensureInvoice(tx, card.id, period);
        }
      }

      if (current.type === 'transfer') {
        const allowed = new Set(['description', 'notes']);
        const blocked = Object.keys(input).filter((k) => !allowed.has(k));
        if (blocked.length > 0) {
          throw businessRule(
            'Em transferências só é possível editar descrição e observações. Para mudar valor, data ou status, cancele e recrie.',
            { fields: blocked },
          );
        }
      }

      if (input.categoryId) {
        await CategoriesService.requireUsableCategory(
          tx,
          userId,
          input.categoryId,
          current.type as 'income' | 'expense',
        );
      }

      const [updated] = await tx
        .update(transactions)
        .set({
          ...input,
          ...(input.amount !== undefined && {
            amount: signedAmount(current.type as 'income' | 'expense', input.amount),
          }),
          ...(newInvoiceId && { invoiceId: newInvoiceId }),
        })
        .where(eq(transactions.id, current.id))
        .returning();
      return toTransactionResponse(updated!);
    });
  }

  /**
   * Nunca apagamos fisicamente: o lançamento vira `cancelled` (sai do saldo, fica na auditoria).
   * Cancelar uma perna de transferência cancela as duas. Idempotente.
   */
  async cancel(userId: string, id: string) {
    await this.db.transaction(async (tx) => {
      const current = await this.findOwned(tx, userId, id, { forUpdate: true });
      if (current.status === 'cancelled') return;

      if (current.source === 'installment') {
        throw businessRule('Parcelas são canceladas pelo parcelamento (DELETE /installment-plans/:id).');
      }
      if (current.invoiceId && current.type !== 'transfer') {
        const [inv] = await tx.select().from(invoices).where(eq(invoices.id, current.invoiceId)).limit(1);
        if (inv && today() >= inv.closingDate) {
          throw businessRule('A fatura deste lançamento já fechou. Registre um estorno em vez de cancelar.');
        }
      }

      const target = current.transferId
        ? eq(transactions.transferId, current.transferId)
        : eq(transactions.id, current.id);

      await tx
        .update(transactions)
        .set({ status: 'cancelled' })
        .where(and(target, eq(transactions.userId, userId)));
    });
  }

  // ─── internos ──────────────────────────────────────────────────────────────

  private async findOwned(
    db: DbExecutor,
    userId: string,
    id: string,
    opts: { forUpdate?: boolean } = {},
  ): Promise<TransactionRow> {
    const query = db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
      .limit(1);
    const [row] = opts.forUpdate ? await query.for('update') : await query;
    if (!row) throw notFound('Transação');
    return row;
  }
}

// ─── Funções puras / helpers ─────────────────────────────────────────────────

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

interface Cursor {
  date: string;
  id: string;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.date, cursor.id])).toString('base64url');
}

function decodeCursor(raw: string): Cursor {
  try {
    const [date, id] = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown[];
    if (
      typeof date === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      typeof id === 'string' &&
      /^[0-9a-f-]{36}$/i.test(id)
    ) {
      return { date, id };
    }
  } catch {
    // cai no erro abaixo
  }
  throw new AppError(400, 'VALIDATION_ERROR', 'Cursor de paginação inválido');
}
