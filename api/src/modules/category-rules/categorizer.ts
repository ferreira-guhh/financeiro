/**
 * Auto-categorização DETERMINÍSTICA (Fase 5).
 *
 * A interface `CategorySuggester` é o ponto de extensão para a Fase 6: um classificador
 * de ML (serviço Python) pode ser adicionado como mais um suggester na cadeia, sem mudar
 * o pipeline de importação. Regras explícitas do usuário sempre têm prioridade.
 */
import { and, asc, desc, eq, gte, isNotNull, isNull, or } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client.js';
import { categories, categoryRules, transactions } from '../../db/schema.js';
import { addDays } from '../../domain/dates.js';
import { today } from '../../lib/clock.js';
import { normalizeDescription } from '../../lib/fingerprint.js';
import { merchantKey } from '../recurring/recurring.service.js';

export type RuleRow = typeof categoryRules.$inferSelect;

export interface SuggestionInput {
  description: string;
  accountId: string;
  type: 'income' | 'expense';
}

export interface Suggestion {
  categoryId: string;
  source: 'rule' | 'history';
  ruleId?: string;
}

export interface CategorySuggester {
  suggest(input: SuggestionInput): Suggestion | null;
}

/** Testa uma regra contra a descrição normalizada (MAIÚSCULAS, sem acento). */
export function ruleMatches(rule: Pick<RuleRow, 'matchType' | 'pattern'>, description: string): boolean {
  const text = normalizeDescription(description);
  if (rule.matchType === 'regex') {
    try {
      return new RegExp(rule.pattern, 'i').test(text);
    } catch {
      return false;
    }
  }
  // Aceita o estilo SQL do planejamento: "%IFOOD%" ≡ contém "IFOOD".
  const pattern = normalizeDescription(rule.pattern.replace(/%/g, ''));
  switch (rule.matchType) {
    case 'contains':
      return text.includes(pattern);
    case 'starts_with':
      return text.startsWith(pattern);
    case 'ends_with':
      return text.endsWith(pattern);
    case 'exact':
      return text === pattern;
  }
}

export class RuleSuggester implements CategorySuggester {
  constructor(private readonly rules: (RuleRow & { categoryType: 'income' | 'expense' })[]) {}

  suggest(input: SuggestionInput): Suggestion | null {
    for (const rule of this.rules) {
      if (rule.accountId && rule.accountId !== input.accountId) continue;
      if (rule.categoryType !== input.type) continue;
      if (ruleMatches(rule, input.description)) return { categoryId: rule.categoryId, source: 'rule', ruleId: rule.id };
    }
    return null;
  }

  static async load(db: DbExecutor, userId: string): Promise<RuleSuggester> {
    const rows = await db
      .select({ rule: categoryRules, categoryType: categories.type })
      .from(categoryRules)
      .innerJoin(categories, eq(categories.id, categoryRules.categoryId))
      .where(and(eq(categoryRules.userId, userId), eq(categoryRules.isActive, true), eq(categories.isArchived, false)))
      .orderBy(asc(categoryRules.priority), asc(categoryRules.createdAt));
    return new RuleSuggester(rows.map((r) => ({ ...r.rule, categoryType: r.categoryType })));
  }
}

/**
 * "Aprende" com o histórico: descrições com a mesma chave de estabelecimento recebem
 * a categoria mais usada pelo usuário para ela (inclui as correções que ele já fez).
 */
export class HistorySuggester implements CategorySuggester {
  constructor(private readonly index: Map<string, string>) {}

  suggest(input: SuggestionInput): Suggestion | null {
    const categoryId = this.index.get(`${input.type}|${merchantKey(input.description)}`);
    return categoryId ? { categoryId, source: 'history' } : null;
  }

  static async load(db: DbExecutor, userId: string): Promise<HistorySuggester> {
    const rows = await db
      .select({ raw: transactions.rawDescription, desc: transactions.description, type: transactions.type, categoryId: transactions.categoryId })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          isNotNull(transactions.categoryId),
          or(eq(transactions.type, 'income'), eq(transactions.type, 'expense')),
          gte(transactions.date, addDays(today(), -400)),
        ),
      )
      .orderBy(desc(transactions.date))
      .limit(5000);

    const counts = new Map<string, Map<string, number>>();
    for (const r of rows) {
      for (const text of new Set([r.raw, r.desc])) {
        const key = `${r.type}|${merchantKey(text)}`;
        if (key.endsWith('|')) continue;
        const byCat = counts.get(key) ?? new Map<string, number>();
        byCat.set(r.categoryId!, (byCat.get(r.categoryId!) ?? 0) + 1);
        counts.set(key, byCat);
      }
    }
    const index = new Map<string, string>();
    for (const [key, byCat] of counts) {
      const best = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];
      if (best) index.set(key, best[0]);
    }
    return new HistorySuggester(index);
  }
}

export class CompositeSuggester implements CategorySuggester {
  constructor(private readonly chain: CategorySuggester[]) {}

  suggest(input: SuggestionInput): Suggestion | null {
    for (const s of this.chain) {
      const result = s.suggest(input);
      if (result) return result;
    }
    return null;
  }

  /** Cadeia padrão: regras do usuário → histórico. (Fase 6: adicionar o classificador de ML aqui.) */
  static async forUser(db: DbExecutor, userId: string): Promise<CompositeSuggester> {
    return new CompositeSuggester([await RuleSuggester.load(db, userId), await HistorySuggester.load(db, userId)]);
  }
}

const NOISE_PREFIXES = [
  'COMPRA CARTAO DEB',
  'COMPRA CARTAO',
  'COMPRA NO DEBITO',
  'COMPRA NO CREDITO',
  'COMPRA',
  'PAGAMENTO EFETUADO',
  'PAGAMENTO',
  'PAG',
  'PIX ENVIADO',
  'PIX RECEBIDO',
  'PIX TRANSF',
  'PIX',
  'TRANSFERENCIA ENVIADA',
  'TRANSFERENCIA RECEBIDA',
  'TED',
  'DOC',
  'DEB AUTOMATICO',
  'DEBITO AUTOMATICO',
  'ELO',
  'VISA',
  'MASTERCARD',
];

/**
 * Sugere o padrão de uma regra a partir de uma descrição bancária:
 * "IFOOD*PEDIDO 1234" → "IFOOD" · "PIX ENVIADO JOAO SILVA" → "JOAO SILVA".
 */
export function suggestPattern(description: string): string {
  let key = merchantKey(description);
  for (const prefix of NOISE_PREFIXES) {
    if (key.startsWith(`${prefix} `)) {
      key = key.slice(prefix.length).trim();
      break;
    }
  }
  const words = key.split(' ').filter(Boolean);
  if (words.length === 0) return normalizeDescription(description).slice(0, 60);
  const first = words[0]!;
  return (first.length >= 4 ? first : words.slice(0, 2).join(' ')).slice(0, 60);
}

/**
 * Categoria pelas REGRAS do usuário para um lançamento manual sem categoria.
 * Só regras explícitas (previsível); o histórico é usado apenas como sugestão na importação.
 */
export async function autoCategoryId(
  db: DbExecutor,
  userId: string,
  input: SuggestionInput,
): Promise<string | null> {
  const suggester = await RuleSuggester.load(db, userId);
  return suggester.suggest(input)?.categoryId ?? null;
}

/** Usado para checar se já há regra igual. */
export async function findRule(db: DbExecutor, userId: string, matchType: RuleRow['matchType'], pattern: string, accountId: string | null) {
  const [row] = await db
    .select()
    .from(categoryRules)
    .where(
      and(
        eq(categoryRules.userId, userId),
        eq(categoryRules.matchType, matchType),
        eq(categoryRules.pattern, pattern),
        accountId ? eq(categoryRules.accountId, accountId) : isNull(categoryRules.accountId),
      ),
    )
    .limit(1);
  return row;
}
