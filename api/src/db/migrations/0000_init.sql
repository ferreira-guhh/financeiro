CREATE TYPE "public"."account_type" AS ENUM('checking', 'savings', 'investment', 'wallet', 'credit_card', 'other');--> statement-breakpoint
CREATE TYPE "public"."cash_flow_type" AS ENUM('income', 'expense');--> statement-breakpoint
CREATE TYPE "public"."goal_kind" AS ENUM('emergency_reserve', 'purchase', 'travel', 'vehicle', 'education', 'investment', 'other');--> statement-breakpoint
CREATE TYPE "public"."goal_status" AS ENUM('active', 'achieved', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."import_action" AS ENUM('import', 'skip', 'reconcile');--> statement-breakpoint
CREATE TYPE "public"."import_batch_status" AS ENUM('preview', 'confirmed', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."import_detection" AS ENUM('new', 'duplicate', 'possible_duplicate', 'reconcile');--> statement-breakpoint
CREATE TYPE "public"."import_source" AS ENUM('csv', 'ofx', 'xlsx', 'open_finance');--> statement-breakpoint
CREATE TYPE "public"."income_basis" AS ENUM('recurring', 'average_3m', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."installment_plan_status" AS ENUM('active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."installment_status" AS ENUM('scheduled', 'posted', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."investment_status" AS ENUM('active', 'redeemed');--> statement-breakpoint
CREATE TYPE "public"."investment_type" AS ENUM('savings', 'cdb', 'lci_lca', 'treasury', 'fund', 'stocks', 'reit', 'crypto', 'pension', 'other');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('pix', 'debit_card', 'credit_card', 'cash', 'bank_slip', 'bank_transfer', 'auto_debit', 'other');--> statement-breakpoint
CREATE TYPE "public"."recurrence_frequency" AS ENUM('weekly', 'monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."rule_match_type" AS ENUM('contains', 'starts_with', 'ends_with', 'exact', 'regex');--> statement-breakpoint
CREATE TYPE "public"."suggestion_source" AS ENUM('rule', 'history', 'none');--> statement-breakpoint
CREATE TYPE "public"."transaction_source" AS ENUM('manual', 'import_ofx', 'import_csv', 'import_xlsx', 'recurring', 'installment', 'open_finance');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('pending', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('income', 'expense', 'transfer');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"type" "account_type" NOT NULL,
	"initial_balance" numeric(15, 2) DEFAULT '0' NOT NULL,
	"currency" char(3) DEFAULT 'BRL' NOT NULL,
	"color" varchar(7),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_user_name_uq" UNIQUE("user_id","name"),
	CONSTRAINT "accounts_currency_chk" CHECK ("accounts"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "accounts_color_chk" CHECK ("accounts"."color" IS NULL OR "accounts"."color" ~ '^#[0-9A-Fa-f]{6}$')
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"action" varchar(120) NOT NULL,
	"entity_id" uuid,
	"status_code" smallint,
	"metadata" jsonb,
	"ip" varchar(64),
	"user_agent" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"parent_id" uuid,
	"name" varchar(60) NOT NULL,
	"type" "cash_flow_type" NOT NULL,
	"icon" varchar(40),
	"color" varchar(7),
	"is_essential" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_not_self_parent_chk" CHECK ("categories"."parent_id" IS NULL OR "categories"."parent_id" <> "categories"."id"),
	CONSTRAINT "categories_color_chk" CHECK ("categories"."color" IS NULL OR "categories"."color" ~ '^#[0-9A-Fa-f]{6}$')
);
--> statement-breakpoint
CREATE TABLE "category_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"account_id" uuid,
	"match_type" "rule_match_type" NOT NULL,
	"pattern" varchar(255) NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_rules_user_match_uq" UNIQUE("user_id","match_type","pattern","account_id"),
	CONSTRAINT "category_rules_pattern_chk" CHECK (length(trim("category_rules"."pattern")) > 0)
);
--> statement-breakpoint
CREATE TABLE "credit_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"payment_account_id" uuid,
	"credit_limit" numeric(15, 2) NOT NULL,
	"closing_day" smallint NOT NULL,
	"due_day" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_cards_account_uq" UNIQUE("account_id"),
	CONSTRAINT "credit_cards_limit_chk" CHECK ("credit_cards"."credit_limit" >= 0),
	CONSTRAINT "credit_cards_closing_day_chk" CHECK ("credit_cards"."closing_day" BETWEEN 1 AND 31),
	CONSTRAINT "credit_cards_due_day_chk" CHECK ("credit_cards"."due_day" BETWEEN 1 AND 31)
);
--> statement-breakpoint
CREATE TABLE "financial_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"kind" "goal_kind" DEFAULT 'other' NOT NULL,
	"target_amount" numeric(15, 2) NOT NULL,
	"initial_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"monthly_contribution" numeric(15, 2),
	"expected_annual_rate" numeric(7, 4),
	"target_date" date,
	"linked_account_id" uuid,
	"status" "goal_status" DEFAULT 'active' NOT NULL,
	"icon" varchar(40),
	"color" varchar(7),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_goals_target_chk" CHECK ("financial_goals"."target_amount" > 0),
	CONSTRAINT "financial_goals_initial_chk" CHECK ("financial_goals"."initial_amount" >= 0),
	CONSTRAINT "financial_goals_contribution_chk" CHECK ("financial_goals"."monthly_contribution" IS NULL OR "financial_goals"."monthly_contribution" > 0),
	CONSTRAINT "financial_goals_rate_chk" CHECK ("financial_goals"."expected_annual_rate" IS NULL OR "financial_goals"."expected_annual_rate" BETWEEN -100 AND 1000)
);
--> statement-breakpoint
CREATE TABLE "goal_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"date" date NOT NULL,
	"note" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_contributions_amount_chk" CHECK ("goal_contributions"."amount" <> 0)
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"source" "import_source" NOT NULL,
	"file_name" varchar(255),
	"file_hash" char(64),
	"status" "import_batch_status" DEFAULT 'preview' NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"imported_count" integer DEFAULT 0 NOT NULL,
	"reconciled_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_index" integer NOT NULL,
	"date" date NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"description" varchar(255) NOT NULL,
	"raw_description" varchar(255) NOT NULL,
	"fit_id" varchar(255),
	"fingerprint" char(64) NOT NULL,
	"detection" "import_detection" NOT NULL,
	"matched_transaction_id" uuid,
	"suggested_category_id" uuid,
	"suggestion_source" "suggestion_source" DEFAULT 'none' NOT NULL,
	"matched_rule_id" uuid,
	"category_id" uuid,
	"action" "import_action" NOT NULL,
	"transaction_id" uuid,
	CONSTRAINT "import_rows_batch_index_uq" UNIQUE("batch_id","row_index"),
	CONSTRAINT "import_rows_amount_chk" CHECK ("import_rows"."amount" <> 0)
);
--> statement-breakpoint
CREATE TABLE "installment_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"category_id" uuid,
	"description" varchar(255) NOT NULL,
	"total_amount" numeric(15, 2) NOT NULL,
	"installment_count" smallint NOT NULL,
	"purchase_date" date NOT NULL,
	"status" "installment_plan_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installment_plans_total_chk" CHECK ("installment_plans"."total_amount" > 0),
	CONSTRAINT "installment_plans_count_chk" CHECK ("installment_plans"."installment_count" BETWEEN 1 AND 420)
);
--> statement-breakpoint
CREATE TABLE "installments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"number" smallint NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"due_date" date NOT NULL,
	"invoice_id" uuid,
	"transaction_id" uuid,
	"status" "installment_status" DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installments_plan_number_uq" UNIQUE("plan_id","number"),
	CONSTRAINT "installments_transaction_uq" UNIQUE("transaction_id"),
	CONSTRAINT "installments_number_chk" CHECK ("installments"."number" >= 1),
	CONSTRAINT "installments_amount_chk" CHECK ("installments"."amount" > 0),
	CONSTRAINT "installments_posted_chk" CHECK ("installments"."status" <> 'posted' OR "installments"."transaction_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "investments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid,
	"goal_id" uuid,
	"name" varchar(120) NOT NULL,
	"type" "investment_type" NOT NULL,
	"invested_amount" numeric(15, 2) NOT NULL,
	"current_amount" numeric(15, 2),
	"invested_at" date NOT NULL,
	"rate_description" varchar(60),
	"annual_rate" numeric(7, 4),
	"liquidity_days" smallint,
	"maturity_date" date,
	"objective" varchar(255),
	"status" "investment_status" DEFAULT 'active' NOT NULL,
	"redeemed_at" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investments_invested_chk" CHECK ("investments"."invested_amount" > 0),
	CONSTRAINT "investments_current_chk" CHECK ("investments"."current_amount" IS NULL OR "investments"."current_amount" >= 0),
	CONSTRAINT "investments_liquidity_chk" CHECK ("investments"."liquidity_days" IS NULL OR "investments"."liquidity_days" >= 0),
	CONSTRAINT "investments_maturity_chk" CHECK ("investments"."maturity_date" IS NULL OR "investments"."maturity_date" >= "investments"."invested_at"),
	CONSTRAINT "investments_redeemed_chk" CHECK (("investments"."status" = 'redeemed') = ("investments"."redeemed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credit_card_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"month" smallint NOT NULL,
	"closing_date" date NOT NULL,
	"due_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_card_period_uq" UNIQUE("credit_card_id","year","month"),
	CONSTRAINT "invoices_month_chk" CHECK ("invoices"."month" BETWEEN 1 AND 12),
	CONSTRAINT "invoices_year_chk" CHECK ("invoices"."year" BETWEEN 2000 AND 2200),
	CONSTRAINT "invoices_dates_chk" CHECK ("invoices"."due_date" >= "invoices"."closing_date")
);
--> statement-breakpoint
CREATE TABLE "recurring_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"category_id" uuid,
	"type" "cash_flow_type" NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"description" varchar(255) NOT NULL,
	"payment_method" "payment_method",
	"frequency" "recurrence_frequency" NOT NULL,
	"interval" smallint DEFAULT 1 NOT NULL,
	"day_of_month" smallint,
	"start_date" date NOT NULL,
	"end_date" date,
	"last_generated_date" date,
	"auto_confirm" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_amount_chk" CHECK ("recurring_transactions"."amount" > 0),
	CONSTRAINT "recurring_interval_chk" CHECK ("recurring_transactions"."interval" BETWEEN 1 AND 365),
	CONSTRAINT "recurring_day_chk" CHECK ("recurring_transactions"."day_of_month" IS NULL OR "recurring_transactions"."day_of_month" BETWEEN 1 AND 31),
	CONSTRAINT "recurring_day_required_chk" CHECK ("recurring_transactions"."frequency" = 'weekly' OR "recurring_transactions"."day_of_month" IS NOT NULL),
	CONSTRAINT "recurring_period_chk" CHECK ("recurring_transactions"."end_date" IS NULL OR "recurring_transactions"."end_date" >= "recurring_transactions"."start_date")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"category_id" uuid,
	"type" "transaction_type" NOT NULL,
	"status" "transaction_status" DEFAULT 'completed' NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"date" date NOT NULL,
	"description" varchar(255) NOT NULL,
	"raw_description" varchar(255) NOT NULL,
	"payment_method" "payment_method",
	"notes" text,
	"source" "transaction_source" DEFAULT 'manual' NOT NULL,
	"fingerprint" char(64) NOT NULL,
	"fit_id" varchar(255),
	"transfer_id" uuid,
	"invoice_id" uuid,
	"recurring_transaction_id" uuid,
	"recurrence_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_account_fingerprint_uq" UNIQUE("account_id","fingerprint"),
	CONSTRAINT "transactions_account_fit_id_uq" UNIQUE("account_id","fit_id"),
	CONSTRAINT "transactions_recurrence_uq" UNIQUE("recurring_transaction_id","recurrence_date"),
	CONSTRAINT "transactions_fingerprint_chk" CHECK ("transactions"."fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "transactions_sign_chk" CHECK (("transactions"."type" = 'income' AND "transactions"."amount" > 0)
       OR ("transactions"."type" = 'expense' AND "transactions"."amount" < 0)
       OR ("transactions"."type" = 'transfer' AND "transactions"."amount" <> 0)),
	CONSTRAINT "transactions_transfer_chk" CHECK (("transactions"."type" = 'transfer') = ("transactions"."transfer_id" IS NOT NULL)),
	CONSTRAINT "transactions_transfer_no_category_chk" CHECK ("transactions"."type" <> 'transfer' OR "transactions"."category_id" IS NULL),
	CONSTRAINT "transactions_recurrence_pair_chk" CHECK ("transactions"."recurring_transaction_id" IS NULL OR "transactions"."recurrence_date" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"income_basis" "income_basis" DEFAULT 'recurring' NOT NULL,
	"fixed_monthly_income" numeric(15, 2),
	"monthly_reserve_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"include_goal_contributions" boolean DEFAULT true NOT NULL,
	"safety_margin_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_reserve_chk" CHECK ("user_settings"."monthly_reserve_amount" >= 0),
	CONSTRAINT "user_settings_income_chk" CHECK ("user_settings"."fixed_monthly_income" IS NULL OR "user_settings"."fixed_monthly_income" >= 0),
	CONSTRAINT "user_settings_fixed_income_required_chk" CHECK ("user_settings"."income_basis" <> 'fixed' OR "user_settings"."fixed_monthly_income" IS NOT NULL),
	CONSTRAINT "user_settings_margin_chk" CHECK ("user_settings"."safety_margin_percent" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"email" varchar(254) NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_payment_account_id_accounts_id_fk" FOREIGN KEY ("payment_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_goals" ADD CONSTRAINT "financial_goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_goals" ADD CONSTRAINT "financial_goals_linked_account_id_accounts_id_fk" FOREIGN KEY ("linked_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_goal_id_financial_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."financial_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_matched_transaction_id_transactions_id_fk" FOREIGN KEY ("matched_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_suggested_category_id_categories_id_fk" FOREIGN KEY ("suggested_category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_matched_rule_id_category_rules_id_fk" FOREIGN KEY ("matched_rule_id") REFERENCES "public"."category_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_plan_id_installment_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."installment_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investments" ADD CONSTRAINT "investments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investments" ADD CONSTRAINT "investments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investments" ADD CONSTRAINT "investments_goal_id_financial_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."financial_goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_credit_card_id_credit_cards_id_fk" FOREIGN KEY ("credit_card_id") REFERENCES "public"."credit_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurring_transaction_id_recurring_transactions_id_fk" FOREIGN KEY ("recurring_transaction_id") REFERENCES "public"."recurring_transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id","is_active");--> statement-breakpoint
CREATE INDEX "audit_logs_user_idx" ON "audit_logs" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "categories_owner_parent_name_uq" ON "categories" USING btree (coalesce("user_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("name"));--> statement-breakpoint
CREATE INDEX "categories_user_idx" ON "categories" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "categories_parent_idx" ON "categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "category_rules_eval_idx" ON "category_rules" USING btree ("user_id","is_active","priority");--> statement-breakpoint
CREATE INDEX "credit_cards_user_idx" ON "credit_cards" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "financial_goals_user_idx" ON "financial_goals" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "goal_contributions_goal_idx" ON "goal_contributions" USING btree ("goal_id","date");--> statement-breakpoint
CREATE INDEX "import_batches_user_idx" ON "import_batches" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "installment_plans_user_idx" ON "installment_plans" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "installments_due_idx" ON "installments" USING btree ("due_date","status");--> statement-breakpoint
CREATE INDEX "installments_invoice_idx" ON "installments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "investments_user_idx" ON "investments" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "invoices_due_idx" ON "invoices" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "recurring_user_active_idx" ON "recurring_transactions" USING btree ("user_id","is_active");--> statement-breakpoint
CREATE INDEX "transactions_user_date_idx" ON "transactions" USING btree ("user_id","date" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_account_date_idx" ON "transactions" USING btree ("account_id","date");--> statement-breakpoint
CREATE INDEX "transactions_user_status_date_idx" ON "transactions" USING btree ("user_id","status","date");--> statement-breakpoint
CREATE INDEX "transactions_category_idx" ON "transactions" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "transactions_invoice_idx" ON "transactions" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "transactions_transfer_idx" ON "transactions" USING btree ("transfer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email"));