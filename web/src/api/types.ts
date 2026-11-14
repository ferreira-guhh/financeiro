/** Tipos das respostas da API (espelham os schemas Zod do backend). Dinheiro = string decimal. */

export type Money = string;

export interface User {
  id: string;
  name: string;
  email: string;
}

export type AccountType = 'checking' | 'savings' | 'investment' | 'wallet' | 'credit_card' | 'other';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  color: string | null;
  isActive: boolean;
  initialBalance: Money;
  balance: Money;
  pendingAmount: Money;
  projectedBalance: Money;
}

export interface Category {
  id: string;
  name: string;
  type: 'income' | 'expense';
  parentId: string | null;
  icon: string | null;
  color: string | null;
  isEssential: boolean;
  isSystem: boolean;
}

export type TxStatus = 'pending' | 'completed' | 'cancelled';

export interface Transaction {
  id: string;
  accountId: string;
  categoryId: string | null;
  type: 'income' | 'expense' | 'transfer';
  status: TxStatus;
  amount: Money;
  date: string;
  description: string;
  rawDescription: string;
  paymentMethod: string | null;
  notes: string | null;
  source: string;
  transferId: string | null;
}

export type InvoiceStatus = 'open' | 'closed' | 'paid' | 'overdue';

export interface InvoiceSummary {
  id: string;
  year: number;
  month: number;
  key: string;
  closingDate: string;
  dueDate: string;
  status: InvoiceStatus;
  total: Money;
  posted: Money;
  scheduled: Money;
  paid: Money;
  pendingPayment: Money;
  remaining: Money;
  itemCount: number;
  projectedRecurring: Money;
}

export interface InvoiceItem {
  kind: 'transaction' | 'scheduled_installment' | 'projected_recurring' | 'payment';
  id: string | null;
  date: string;
  description: string;
  amount: Money;
  categoryId: string | null;
  status: string | null;
}

export interface CreditCard {
  id: string;
  accountId: string;
  name: string;
  color: string | null;
  isActive: boolean;
  creditLimit: Money;
  usedLimit: Money;
  availableLimit: Money;
  closingDay: number;
  dueDay: number;
  paymentAccountId: string | null;
  currentInvoice: InvoiceSummary | null;
  nextDueInvoice: InvoiceSummary | null;
}

export interface Installment {
  id: string;
  number: number;
  amount: Money;
  date: string;
  status: 'scheduled' | 'posted' | 'cancelled';
  invoiceKey: string | null;
}

export interface InstallmentPlan {
  id: string;
  accountId: string;
  accountName: string;
  accountType: string;
  categoryId: string | null;
  description: string;
  status: 'active' | 'completed' | 'cancelled';
  totalAmount: Money;
  installmentCount: number;
  installmentAmount: Money;
  firstInstallmentAmount: Money;
  purchaseDate: string;
  firstDate: string;
  lastDate: string;
  currentInstallment: number;
  remainingCount: number;
  postedAmount: Money;
  remainingAmount: Money;
  nextDate: string | null;
  installments?: Installment[];
}

export interface Schedule {
  months: { month: string; total: Money; count: number; cardTotal: Money }[];
  totalCommitted: Money;
}

export interface Recurring {
  id: string;
  accountId: string;
  accountName: string;
  accountType: string;
  categoryId: string | null;
  type: 'income' | 'expense';
  amount: Money;
  description: string;
  frequency: 'weekly' | 'monthly' | 'yearly';
  interval: number;
  dayOfMonth: number | null;
  startDate: string;
  endDate: string | null;
  autoConfirm: boolean;
  isActive: boolean;
  nextOccurrence: string | null;
  monthlyEquivalent: Money;
}

export interface UpcomingItem {
  date: string;
  description: string;
  amount: Money;
  accountId: string;
  categoryId: string | null;
  recurringTransactionId: string | null;
  kind: 'pending' | 'projected';
  transactionId: string | null;
  overdue: boolean;
}

export interface RecurringSuggestion {
  description: string;
  accountId: string;
  categoryId: string | null;
  type: 'income' | 'expense';
  amount: Money;
  dayOfMonth: number;
  occurrences: number;
  lastDate: string;
  amountVariationPercent: string;
}

export interface Goal {
  id: string;
  name: string;
  kind: string;
  status: 'active' | 'achieved' | 'cancelled';
  targetAmount: Money;
  initialAmount: Money;
  currentAmount: Money;
  remainingAmount: Money;
  progressPercent: string;
  monthlyContribution: Money | null;
  expectedAnnualRate: string | null;
  targetDate: string | null;
  linkedAccountId: string | null;
  color: string | null;
  isReached: boolean;
  monthsLeft: number | null;
  requiredMonthlyContribution: Money | null;
  forecastMonth: string | null;
  onTrack: boolean | null;
}

export interface GoalProjection {
  goal: Goal;
  monthlyContribution: Money;
  annualRate: string;
  reached: boolean;
  months: number | null;
  reachedMonth: string | null;
  totalContributed: Money;
  totalInterest: Money;
  series: { month: string; balance: Money }[];
  alternatives: { label: string; monthlyContribution: Money; months: number | null; reachedMonth: string | null }[];
}

export interface Investment {
  id: string;
  name: string;
  type: string;
  status: 'active' | 'redeemed';
  investedAmount: Money;
  currentAmount: Money | null;
  gain: Money | null;
  gainPercent: string | null;
  investedAt: string;
  rateDescription: string | null;
  liquidityDays: number | null;
  liquidityBucket: string;
  maturityDate: string | null;
  daysToMaturity: number | null;
  objective: string | null;
  accountId: string | null;
}

export interface InvestmentSummary {
  totalInvested: Money;
  totalCurrent: Money;
  byType: { type: string; invested: Money; current: Money; count: number }[];
  byLiquidity: { bucket: string; current: Money; count: number }[];
  maturingNext90Days: { id: string; name: string; maturityDate: string; current: Money }[];
}

export interface SafeToSpend {
  month: string;
  incomeSource: 'recurring' | 'average_3m' | 'fixed';
  income: Money;
  fixedExpenses: Money;
  installments: Money;
  otherScheduled: Money;
  reserve: Money;
  goalContributions: Money;
  safetyMargin: Money;
  discretionary: Money;
  spentSoFar: Money;
  remaining: Money;
  daysLeft: number;
  dailySafeAmount: Money;
  disclaimer: string;
}

export interface Dashboard {
  month: string;
  today: string;
  balances: { current: Money; investments: Money; creditCardDebt: Money; netWorth: Money };
  monthSummary: { income: Money; expenses: Money; net: Money; savingsRate: string };
  available: { amount: Money; lowestBalance: Money; lowestDate: string };
  upcomingBills: { total: Money; overdueCount: number; items: UpcomingItem[] };
  upcomingInstallments: Schedule;
  creditCards: Pick<CreditCard, 'id' | 'name' | 'color' | 'availableLimit' | 'creditLimit' | 'currentInvoice' | 'nextDueInvoice'>[];
  safeToSpend: SafeToSpend;
  goals: Goal[];
}

export interface MonthPoint {
  month: string;
  income: Money;
  expenses: Money;
  net: Money;
  savingsRate: string;
  fixedIncome: Money;
  variableIncome: Money;
  recurringExpenses: Money;
  installmentExpenses: Money;
  essentialExpenses: Money;
  endBalance: Money | null;
  endNetWorth: Money | null;
}

export interface CategoryRow {
  categoryId: string | null;
  name: string;
  color: string | null;
  isEssential: boolean;
  total: Money;
  count: number;
  share: string;
}

export interface ExpenseItem {
  id: string;
  date: string;
  description: string;
  amount: Money;
  categoryName: string | null;
}

export interface WeeklyReport {
  weekStart: string;
  weekEnd: string;
  income: Money;
  expenses: Money;
  net: Money;
  topCategories: CategoryRow[];
  biggestExpenses: ExpenseItem[];
  comparison: { previousWeekExpenses: Money; changeVsPreviousWeek: string | null; average4WeeksExpenses: Money; changeVsAverage: string | null };
  previousWeeks: { weekStart: string; income: Money; expenses: Money }[];
}

export interface MonthlyReport {
  month: string;
  income: Money;
  expenses: Money;
  balance: Money;
  savingsRate: string;
  fixedIncome: Money;
  variableIncome: Money;
  essentialExpenses: Money;
  lifestyleExpenses: Money;
  byCategory: (CategoryRow & { previous: Money; changeVsPrevious: string | null })[];
  comparison: { previousMonth: string; previousIncome: Money; previousExpenses: Money; incomeChange: string | null; expensesChange: string | null; previousSavingsRate: string };
  biggestExpenses: ExpenseItem[];
  insights: { category: string; current: Money; average3m: Money; changePercent: string; message: string }[];
}

export interface YearlyReport {
  year: number;
  totalIncome: Money;
  totalExpenses: Money;
  balance: Money;
  savingsRate: string;
  totalInvested: Money;
  monthlyAverageIncome: Money;
  monthlyAverageExpenses: Money;
  startNetWorth: Money;
  endNetWorth: Money;
  topCategories: CategoryRow[];
  bestMonth: string | null;
  worstMonth: string | null;
  months: MonthPoint[];
}

export interface Metrics {
  month: string;
  savingsMargin: { income: Money; expenses: Money; rate: string };
  burnRate: { monthly: Money; runwayMonths: string | null };
  breakEven: { fixedCosts: Money; averageVariable: Money; requiredIncome: Money; currentIncome: Money; coverage: string };
  accumulatedExpenses: { monthToDate: Money; yearToDate: Money };
  incomeCommitment: { fixedRecurring: Money; installments: Money; percent: string };
  averageSpending: { dailyThisMonth: Money; monthlyLast6: Money };
  balanceProjection: {
    current: Money;
    endOfMonth: Money | null;
    in3Months: Money | null;
    in6Months: Money | null;
    withVariableSpending: { endOfMonth: Money | null; in3Months: Money | null; in6Months: Money | null };
  };
}

export interface Forecast {
  startDate: string;
  endDate: string;
  startBalance: Money;
  includesVariableAverage: boolean;
  days: { date: string; balance: Money; inflow: Money; outflow: Money }[];
  months: { month: string; startBalance: Money; income: Money; expenses: Money; cardInvoices: Money; endBalance: Money; lowestBalance: Money; lowestDate: string }[];
  events: { date: string; description: string; amount: Money; kind: string }[];
  summary: { endBalance: Money; lowestBalance: Money; lowestDate: string; firstNegativeDate: string | null };
}

export interface ImportRow {
  id: string;
  rowIndex: number;
  date: string;
  amount: Money;
  description: string;
  fitId: string | null;
  detection: 'new' | 'duplicate' | 'possible_duplicate' | 'reconcile';
  suggestedCategoryId: string | null;
  suggestionSource: 'rule' | 'history' | 'none';
  categoryId: string | null;
  action: 'import' | 'skip' | 'reconcile';
}

export interface ImportBatch {
  id: string;
  accountId: string;
  accountName: string;
  source: string;
  fileName: string | null;
  status: 'preview' | 'confirmed' | 'discarded';
  rowCount: number;
  importedCount: number;
  reconciledCount: number;
  skippedCount: number;
  createdAt: string;
  rows?: ImportRow[];
  summary?: { new: number; duplicate: number; possibleDuplicate: number; reconcile: number; categorized: number; toImport: number; toReconcile: number; toSkip: number };
  warnings?: string[];
}

export interface CategoryRule {
  id: string;
  categoryId: string;
  categoryName: string;
  matchType: 'contains' | 'starts_with' | 'ends_with' | 'exact' | 'regex';
  pattern: string;
  priority: number;
  isActive: boolean;
}

export interface Settings {
  incomeBasis: 'recurring' | 'average_3m' | 'fixed';
  fixedMonthlyIncome: Money | null;
  monthlyReserveAmount: Money;
  includeGoalContributions: boolean;
  safetyMarginPercent: string;
}

export interface List<T> {
  data: T[];
}
