/**
 * Schema do banco — fonte única da verdade para tabelas, enums, índices e constraints.
 *
 * Convenções:
 * - Chaves em camelCase aqui; colunas em snake_case no Postgres (casing: 'snake_case').
 * - Dinheiro: NUMERIC(15,2), lido pelo driver como string ("1234.56"). Nunca float.
 * - Datas contábeis: DATE (sem fuso). Instantes de auditoria: TIMESTAMPTZ.
 * - PKs: UUID nativo (gen_random_uuid()).
 * - Livro-caixa com valores ASSINADOS: entrada > 0, saída < 0.
 *   Saldo de uma conta = initial_balance + SUM(amount) das transações concluídas.
 * - Cartão de crédito é uma conta do tipo `credit_card` (passivo): compras entram negativas,
 *   pagamento de fatura é uma transferência conta corrente -> conta do cartão.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

// ─── Helpers de coluna ───────────────────────────────────────────────────────

const money = () => numeric({ precision: 15, scale: 2 });
const id = () => uuid().primaryKey().defaultRandom();
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

const NIL_UUID = sql`'00000000-0000-0000-0000-000000000000'::uuid`;

// ─── Enums ───────────────────────────────────────────────────────────────────

export const accountTypeEnum = pgEnum('account_type', [
  'checking',
  'savings',
  'investment',
  'wallet',
  'credit_card',
  'other',
]);

/** Natureza de categorias e recorrências. */
export const cashFlowTypeEnum = pgEnum('cash_flow_type', ['income', 'expense']);

export const transactionTypeEnum = pgEnum('transaction_type', ['income', 'expense', 'transfer']);

export const transactionStatusEnum = pgEnum('transaction_status', [
  'pending',
  'completed',
  'cancelled',
]);

export const paymentMethodEnum = pgEnum('payment_method', [
  'pix',
  'debit_card',
  'credit_card',
  'cash',
  'bank_slip', // boleto
  'bank_transfer', // TED/DOC
  'auto_debit',
  'other',
]);

/** De onde a transação veio — essencial para auditoria e reimportações. */
export const transactionSourceEnum = pgEnum('transaction_source', [
  'manual',
  'import_ofx',
  'import_csv',
  'import_xlsx',
  'recurring',
  'installment',
  'open_finance',
]);


export const installmentPlanStatusEnum = pgEnum('installment_plan_status', [
  'active',
  'completed',
  'cancelled',
]);

export const installmentStatusEnum = pgEnum('installment_status', [
  'scheduled', // projeção — ainda não está no livro-caixa
  'posted', // virou transação real
  'cancelled',
]);

export const recurrenceFrequencyEnum = pgEnum('recurrence_frequency', [
  'weekly',
  'monthly',
  'yearly',
]);

export const goalStatusEnum = pgEnum('goal_status', ['active', 'achieved', 'cancelled']);

export const goalKindEnum = pgEnum('goal_kind', [
  'emergency_reserve',
  'purchase',
  'travel',
  'vehicle',
  'education',
  'investment',
  'other',
]);

export const investmentTypeEnum = pgEnum('investment_type', [
  'savings', // poupança
  'cdb',
  'lci_lca',
  'treasury', // Tesouro Direto
  'fund',
  'stocks',
  'reit', // FII
  'crypto',
  'pension', // previdência
  'other',
]);

export const investmentStatusEnum = pgEnum('investment_status', ['active', 'redeemed']);

export const incomeBasisEnum = pgEnum('income_basis', ['recurring', 'average_3m', 'fixed']);

export const importSourceEnum = pgEnum('import_source', ['csv', 'ofx', 'xlsx', 'open_finance']);

export const importBatchStatusEnum = pgEnum('import_batch_status', [
  'preview',
  'confirmed',
  'discarded',
]);

export const importDetectionEnum = pgEnum('import_detection', [
  'new',
  'duplicate', // mesmo FITID ou fingerprint já no livro-caixa
  'possible_duplicate', // mesmo valor, data próxima, descrição diferente
  'reconcile', // casa com um lançamento PENDENTE (ex.: recorrente gerada)
]);

export const importActionEnum = pgEnum('import_action', ['import', 'skip', 'reconcile']);

export const suggestionSourceEnum = pgEnum('suggestion_source', ['rule', 'history', 'none']);

export const ruleMatchTypeEnum = pgEnum('rule_match_type', [
  'contains',
  'starts_with',
  'ends_with',
  'exact',
  'regex',
]);

// ─── users ───────────────────────────────────────────────────────────────────

export const users = pgTable(
  'users',
  {
    id: id(),
    name: varchar({ length: 120 }).notNull(),
    email: varchar({ length: 254 }).notNull(),
    passwordHash: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_email_lower_uq').on(sql`lower(${t.email})`)],
);

// ─── accounts ────────────────────────────────────────────────────────────────

export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar({ length: 80 }).notNull(),
    type: accountTypeEnum().notNull(),
    initialBalance: money().notNull().default('0'),
    currency: char({ length: 3 }).notNull().default('BRL'),
    color: varchar({ length: 7 }),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('accounts_user_name_uq').on(t.userId, t.name),
    index('accounts_user_idx').on(t.userId, t.isActive),
    check('accounts_currency_chk', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check('accounts_color_chk', sql`${t.color} IS NULL OR ${t.color} ~ '^#[0-9A-Fa-f]{6}$'`),
  ],
);

// ─── categories ──────────────────────────────────────────────────────────────

export const categories = pgTable(
  'categories',
  {
    id: id(),
    /** NULL = categoria padrão do sistema (visível para todos). */
    userId: uuid().references(() => users.id, { onDelete: 'cascade' }),
    parentId: uuid().references((): AnyPgColumn => categories.id, { onDelete: 'restrict' }),
    name: varchar({ length: 60 }).notNull(),
    type: cashFlowTypeEnum().notNull(),
    icon: varchar({ length: 40 }),
    color: varchar({ length: 7 }),
    isEssential: boolean().notNull().default(false),
    isArchived: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Nome único (case-insensitive) por dono + pai. COALESCE trata NULL (sistema / raiz) como valor.
    uniqueIndex('categories_owner_parent_name_uq').on(
      sql`coalesce(${t.userId}, ${NIL_UUID})`,
      sql`coalesce(${t.parentId}, ${NIL_UUID})`,
      sql`lower(${t.name})`,
    ),
    index('categories_user_idx').on(t.userId),
    index('categories_parent_idx').on(t.parentId),
    check('categories_not_self_parent_chk', sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`),
    check('categories_color_chk', sql`${t.color} IS NULL OR ${t.color} ~ '^#[0-9A-Fa-f]{6}$'`),
  ],
);

// ─── credit_cards & invoices ─────────────────────────────────────────────────

export const creditCards = pgTable(
  'credit_cards',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Conta-livro do cartão (type = credit_card). Nome e cor vivem nela. */
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    /** Conta que normalmente paga a fatura (ex.: conta corrente). */
    paymentAccountId: uuid().references(() => accounts.id, { onDelete: 'set null' }),
    creditLimit: money().notNull(),
    closingDay: smallint().notNull(),
    dueDay: smallint().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('credit_cards_account_uq').on(t.accountId),
    index('credit_cards_user_idx').on(t.userId),
    check('credit_cards_limit_chk', sql`${t.creditLimit} >= 0`),
    check('credit_cards_closing_day_chk', sql`${t.closingDay} BETWEEN 1 AND 31`),
    check('credit_cards_due_day_chk', sql`${t.dueDay} BETWEEN 1 AND 31`),
  ],
);

/**
 * Fatura = um PERÍODO do cartão (ano/mês do vencimento + datas de fechamento e vencimento).
 * Total, valor pago e status (aberta/fechada/paga/vencida) são DERIVADOS do livro-caixa,
 * nunca armazenados — assim não existe fatura com total divergente das transações.
 */
export const invoices = pgTable(
  'invoices',
  {
    id: id(),
    creditCardId: uuid()
      .notNull()
      .references(() => creditCards.id, { onDelete: 'cascade' }),
    year: smallint().notNull(),
    month: smallint().notNull(),
    closingDate: date({ mode: 'string' }).notNull(),
    dueDate: date({ mode: 'string' }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('invoices_card_period_uq').on(t.creditCardId, t.year, t.month),
    index('invoices_due_idx').on(t.dueDate),
    check('invoices_month_chk', sql`${t.month} BETWEEN 1 AND 12`),
    check('invoices_year_chk', sql`${t.year} BETWEEN 2000 AND 2200`),
    check('invoices_dates_chk', sql`${t.dueDate} >= ${t.closingDate}`),
  ],
);

// ─── recurring_transactions (modelos; geram transações reais sob demanda) ───

export const recurringTransactions = pgTable(
  'recurring_transactions',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    categoryId: uuid().references(() => categories.id, { onDelete: 'restrict' }),
    type: cashFlowTypeEnum().notNull(),
    /** Valor absoluto; o sinal vem de `type` ao gerar a transação. */
    amount: money().notNull(),
    description: varchar({ length: 255 }).notNull(),
    paymentMethod: paymentMethodEnum(),
    frequency: recurrenceFrequencyEnum().notNull(),
    /** A cada N períodos (ex.: frequency=monthly, interval=3 → trimestral). */
    interval: smallint().notNull().default(1),
    /** Para monthly/yearly. 31 em mês curto = último dia do mês. */
    dayOfMonth: smallint(),
    startDate: date({ mode: 'string' }).notNull(),
    endDate: date({ mode: 'string' }),
    /** Última ocorrência já materializada no livro-caixa. */
    lastGeneratedDate: date({ mode: 'string' }),
    /**
     * false (padrão): a ocorrência entra como `pending` e o usuário confirma quando pagar/receber.
     * true: entra direto como `completed` (ex.: débito automático garantido).
     */
    autoConfirm: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('recurring_user_active_idx').on(t.userId, t.isActive),
    check('recurring_amount_chk', sql`${t.amount} > 0`),
    check('recurring_interval_chk', sql`${t.interval} BETWEEN 1 AND 365`),
    check(
      'recurring_day_chk',
      sql`${t.dayOfMonth} IS NULL OR ${t.dayOfMonth} BETWEEN 1 AND 31`,
    ),
    check(
      'recurring_day_required_chk',
      sql`${t.frequency} = 'weekly' OR ${t.dayOfMonth} IS NOT NULL`,
    ),
    check('recurring_period_chk', sql`${t.endDate} IS NULL OR ${t.endDate} >= ${t.startDate}`),
  ],
);

// ─── transactions (livro-caixa real) ─────────────────────────────────────────

export const transactions = pgTable(
  'transactions',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    categoryId: uuid().references(() => categories.id, { onDelete: 'restrict' }),
    type: transactionTypeEnum().notNull(),
    status: transactionStatusEnum().notNull().default('completed'),
    /** Assinado: entrada > 0, saída < 0. */
    amount: money().notNull(),
    date: date({ mode: 'string' }).notNull(),
    /** Texto exibido/editável pelo usuário. */
    description: varchar({ length: 255 }).notNull(),
    /** Texto original (extrato/digitação). Imutável; base do fingerprint e das regras. */
    rawDescription: varchar({ length: 255 }).notNull(),
    paymentMethod: paymentMethodEnum(),
    notes: text(),
    source: transactionSourceEnum().notNull().default('manual'),

    /** SHA-256 hex de account_id|date|amount|raw_description normalizada. Imutável. */
    fingerprint: char({ length: 64 }).notNull(),
    /** FITID do OFX (único por conta quando presente). */
    fitId: varchar({ length: 255 }),

    /** As duas pernas de uma transferência compartilham o mesmo transfer_id. */
    transferId: uuid(),
    invoiceId: uuid().references(() => invoices.id, { onDelete: 'restrict' }),
    recurringTransactionId: uuid().references(() => recurringTransactions.id, {
      onDelete: 'set null',
    }),
    /** Data "agendada" da ocorrência recorrente (idempotência da geração). */
    recurrenceDate: date({ mode: 'string' }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('transactions_account_fingerprint_uq').on(t.accountId, t.fingerprint),
    unique('transactions_account_fit_id_uq').on(t.accountId, t.fitId),
    unique('transactions_recurrence_uq').on(t.recurringTransactionId, t.recurrenceDate),

    index('transactions_user_date_idx').on(t.userId, t.date.desc(), t.id.desc()),
    index('transactions_account_date_idx').on(t.accountId, t.date),
    index('transactions_user_status_date_idx').on(t.userId, t.status, t.date),
    index('transactions_category_idx').on(t.categoryId),
    index('transactions_invoice_idx').on(t.invoiceId),
    index('transactions_transfer_idx').on(t.transferId),

    check('transactions_fingerprint_chk', sql`${t.fingerprint} ~ '^[0-9a-f]{64}$'`),
    check(
      'transactions_sign_chk',
      sql`(${t.type} = 'income' AND ${t.amount} > 0)
       OR (${t.type} = 'expense' AND ${t.amount} < 0)
       OR (${t.type} = 'transfer' AND ${t.amount} <> 0)`,
    ),
    check(
      'transactions_transfer_chk',
      sql`(${t.type} = 'transfer') = (${t.transferId} IS NOT NULL)`,
    ),
    check(
      'transactions_transfer_no_category_chk',
      sql`${t.type} <> 'transfer' OR ${t.categoryId} IS NULL`,
    ),
    check(
      'transactions_recurrence_pair_chk',
      // Toda transação gerada por recorrência tem data de ocorrência.
      // (O inverso pode existir se o modelo recorrente for apagado — FK vira NULL.)
      sql`${t.recurringTransactionId} IS NULL OR ${t.recurrenceDate} IS NOT NULL`,
    ),
  ],
);

// ─── installment_plans & installments ────────────────────────────────────────

export const installmentPlans = pgTable(
  'installment_plans',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Conta onde as parcelas são lançadas (normalmente a conta-livro do cartão). */
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    categoryId: uuid().references(() => categories.id, { onDelete: 'restrict' }),
    description: varchar({ length: 255 }).notNull(),
    totalAmount: money().notNull(),
    installmentCount: smallint().notNull(),
    purchaseDate: date({ mode: 'string' }).notNull(),
    status: installmentPlanStatusEnum().notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('installment_plans_user_idx').on(t.userId, t.status),
    check('installment_plans_total_chk', sql`${t.totalAmount} > 0`),
    check('installment_plans_count_chk', sql`${t.installmentCount} BETWEEN 1 AND 420`),
  ],
);

export const installments = pgTable(
  'installments',
  {
    id: id(),
    planId: uuid()
      .notNull()
      .references(() => installmentPlans.id, { onDelete: 'cascade' }),
    number: smallint().notNull(),
    /** Valor absoluto da parcela (a diferença de centavos fica na 1ª parcela). */
    amount: money().notNull(),
    /** Data de referência para lançamento (define a fatura). */
    dueDate: date({ mode: 'string' }).notNull(),
    invoiceId: uuid().references(() => invoices.id, { onDelete: 'set null' }),
    /** Preenchido quando a parcela é materializada no livro-caixa. */
    transactionId: uuid().references(() => transactions.id, { onDelete: 'set null' }),
    status: installmentStatusEnum().notNull().default('scheduled'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('installments_plan_number_uq').on(t.planId, t.number),
    unique('installments_transaction_uq').on(t.transactionId),
    index('installments_due_idx').on(t.dueDate, t.status),
    index('installments_invoice_idx').on(t.invoiceId),
    check('installments_number_chk', sql`${t.number} >= 1`),
    check('installments_amount_chk', sql`${t.amount} > 0`),
    check(
      'installments_posted_chk',
      sql`${t.status} <> 'posted' OR ${t.transactionId} IS NOT NULL`,
    ),
  ],
);

// ─── financial_goals ─────────────────────────────────────────────────────────

export const financialGoals = pgTable(
  'financial_goals',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar({ length: 120 }).notNull(),
    kind: goalKindEnum().notNull().default('other'),
    targetAmount: money().notNull(),
    /** Valor já guardado ao criar a meta. Valor atual = initial + SUM(aportes). */
    initialAmount: money().notNull().default('0'),
    /** Aporte mensal desejado (alimenta previsões e o gasto seguro). */
    monthlyContribution: money(),
    /** Rentabilidade esperada em % a.a. (ex.: 10.5000). Opcional, só para projeções. */
    expectedAnnualRate: numeric({ precision: 7, scale: 4 }),
    targetDate: date({ mode: 'string' }),
    /** Se definido, o valor atual da meta passa a ser o saldo dessa conta. */
    linkedAccountId: uuid().references(() => accounts.id, { onDelete: 'set null' }),
    status: goalStatusEnum().notNull().default('active'),
    icon: varchar({ length: 40 }),
    color: varchar({ length: 7 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('financial_goals_user_idx').on(t.userId, t.status),
    check('financial_goals_target_chk', sql`${t.targetAmount} > 0`),
    check('financial_goals_initial_chk', sql`${t.initialAmount} >= 0`),
    check(
      'financial_goals_contribution_chk',
      sql`${t.monthlyContribution} IS NULL OR ${t.monthlyContribution} > 0`,
    ),
    check(
      'financial_goals_rate_chk',
      sql`${t.expectedAnnualRate} IS NULL OR ${t.expectedAnnualRate} BETWEEN -100 AND 1000`,
    ),
  ],
);

// ─── category_rules (auto-categorização determinística) ─────────────────────

export const categoryRules = pgTable(
  'category_rules',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    categoryId: uuid()
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    /** Restringe a regra a uma conta (opcional). */
    accountId: uuid().references(() => accounts.id, { onDelete: 'cascade' }),
    matchType: ruleMatchTypeEnum().notNull(),
    /** Comparado com raw_description normalizada (MAIÚSCULAS, sem acento). */
    pattern: varchar({ length: 255 }).notNull(),
    /** Menor número = avaliada primeiro. Primeira que casar vence. */
    priority: integer().notNull().default(100),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('category_rules_user_match_uq').on(t.userId, t.matchType, t.pattern, t.accountId),
    index('category_rules_eval_idx').on(t.userId, t.isActive, t.priority),
    check('category_rules_pattern_chk', sql`length(trim(${t.pattern})) > 0`),
  ],
);

// ─── goal_contributions (aportes/resgates de metas sem conta vinculada) ─────

export const goalContributions = pgTable(
  'goal_contributions',
  {
    id: id(),
    goalId: uuid()
      .notNull()
      .references(() => financialGoals.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Positivo = aporte, negativo = resgate. */
    amount: money().notNull(),
    date: date({ mode: 'string' }).notNull(),
    note: varchar({ length: 255 }),
    createdAt: createdAt(),
  },
  (t) => [
    index('goal_contributions_goal_idx').on(t.goalId, t.date),
    check('goal_contributions_amount_chk', sql`${t.amount} <> 0`),
  ],
);

// ─── investments (registro de posições — sem recomendações automáticas) ─────

export const investments = pgTable(
  'investments',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Conta de investimento onde a posição está (opcional). */
    accountId: uuid().references(() => accounts.id, { onDelete: 'set null' }),
    goalId: uuid().references(() => financialGoals.id, { onDelete: 'set null' }),
    name: varchar({ length: 120 }).notNull(),
    type: investmentTypeEnum().notNull(),
    investedAmount: money().notNull(),
    /** Valor atual informado pelo usuário (opcional). */
    currentAmount: money(),
    investedAt: date({ mode: 'string' }).notNull(),
    /** Rentabilidade como o banco informa, ex.: "110% do CDI", "IPCA + 6%". */
    rateDescription: varchar({ length: 60 }),
    /** Equivalente numérico em % a.a., se o usuário quiser usar em projeções. */
    annualRate: numeric({ precision: 7, scale: 4 }),
    /** Dias para resgate (0 = liquidez diária). NULL = só no vencimento. */
    liquidityDays: smallint(),
    maturityDate: date({ mode: 'string' }),
    objective: varchar({ length: 255 }),
    status: investmentStatusEnum().notNull().default('active'),
    redeemedAt: date({ mode: 'string' }),
    notes: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('investments_user_idx').on(t.userId, t.status),
    check('investments_invested_chk', sql`${t.investedAmount} > 0`),
    check('investments_current_chk', sql`${t.currentAmount} IS NULL OR ${t.currentAmount} >= 0`),
    check('investments_liquidity_chk', sql`${t.liquidityDays} IS NULL OR ${t.liquidityDays} >= 0`),
    check(
      'investments_maturity_chk',
      sql`${t.maturityDate} IS NULL OR ${t.maturityDate} >= ${t.investedAt}`,
    ),
    check(
      'investments_redeemed_chk',
      sql`(${t.status} = 'redeemed') = (${t.redeemedAt} IS NOT NULL)`,
    ),
  ],
);

// ─── user_settings (parâmetros da margem discricionária / gasto seguro) ─────

export const userSettings = pgTable(
  'user_settings',
  {
    userId: uuid()
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** De onde vem a "receita do mês" no cálculo do gasto seguro. */
    incomeBasis: incomeBasisEnum().notNull().default('recurring'),
    fixedMonthlyIncome: money(),
    /** Quanto reservar por mês (reserva de emergência, etc.). */
    monthlyReserveAmount: money().notNull().default('0'),
    /** Descontar os aportes mensais das metas ativas. */
    includeGoalContributions: boolean().notNull().default(true),
    /** Folga de segurança em % da receita. */
    safetyMarginPercent: numeric({ precision: 5, scale: 2 }).notNull().default('0'),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('user_settings_reserve_chk', sql`${t.monthlyReserveAmount} >= 0`),
    check(
      'user_settings_income_chk',
      sql`${t.fixedMonthlyIncome} IS NULL OR ${t.fixedMonthlyIncome} >= 0`,
    ),
    check(
      'user_settings_fixed_income_required_chk',
      sql`${t.incomeBasis} <> 'fixed' OR ${t.fixedMonthlyIncome} IS NOT NULL`,
    ),
    check('user_settings_margin_chk', sql`${t.safetyMarginPercent} BETWEEN 0 AND 100`),
  ],
);

// ─── import_batches & import_rows (upload → prévia → confirmação) ───────────

export const importBatches = pgTable(
  'import_batches',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    source: importSourceEnum().notNull(),
    fileName: varchar({ length: 255 }),
    /** SHA-256 do arquivo — avisa quando o mesmo arquivo é enviado de novo. */
    fileHash: char({ length: 64 }),
    status: importBatchStatusEnum().notNull().default('preview'),
    rowCount: integer().notNull().default(0),
    importedCount: integer().notNull().default(0),
    reconciledCount: integer().notNull().default(0),
    skippedCount: integer().notNull().default(0),
    createdAt: createdAt(),
    confirmedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index('import_batches_user_idx').on(t.userId, t.createdAt.desc())],
);

export const importRows = pgTable(
  'import_rows',
  {
    id: id(),
    batchId: uuid()
      .notNull()
      .references(() => importBatches.id, { onDelete: 'cascade' }),
    rowIndex: integer().notNull(),
    date: date({ mode: 'string' }).notNull(),
    /** Assinado, como no livro-caixa. */
    amount: money().notNull(),
    description: varchar({ length: 255 }).notNull(),
    rawDescription: varchar({ length: 255 }).notNull(),
    fitId: varchar({ length: 255 }),
    fingerprint: char({ length: 64 }).notNull(),
    detection: importDetectionEnum().notNull(),
    /** Transação existente relacionada (duplicata, possível duplicata ou conciliação). */
    matchedTransactionId: uuid().references(() => transactions.id, { onDelete: 'set null' }),
    suggestedCategoryId: uuid().references(() => categories.id, { onDelete: 'set null' }),
    suggestionSource: suggestionSourceEnum().notNull().default('none'),
    matchedRuleId: uuid().references(() => categoryRules.id, { onDelete: 'set null' }),
    /** Categoria final escolhida pelo usuário (começa = sugestão). */
    categoryId: uuid().references(() => categories.id, { onDelete: 'set null' }),
    action: importActionEnum().notNull(),
    /** Transação criada ou conciliada na confirmação. */
    transactionId: uuid().references(() => transactions.id, { onDelete: 'set null' }),
  },
  (t) => [
    unique('import_rows_batch_index_uq').on(t.batchId, t.rowIndex),
    check('import_rows_amount_chk', sql`${t.amount} <> 0`),
  ],
);

// ─── audit_logs (operações importantes) ──────────────────────────────────────

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    userId: uuid().references(() => users.id, { onDelete: 'set null' }),
    /** Ex.: "POST /api/v1/transactions", "auth.login_failed". */
    action: varchar({ length: 120 }).notNull(),
    entityId: uuid(),
    statusCode: smallint(),
    metadata: jsonb().$type<Record<string, unknown>>(),
    ip: varchar({ length: 64 }),
    userAgent: varchar({ length: 255 }),
    createdAt: createdAt(),
  },
  (t) => [index('audit_logs_user_idx').on(t.userId, t.createdAt.desc())],
);
