import { z } from 'zod';
import { creditCardResponseSchema, invoiceSummarySchema } from '../credit-cards/credit-cards.schemas.js';
import { goalResponseSchema } from '../goals/goals.schemas.js';
import { scheduleResponseSchema } from '../installment-plans/installment-plans.schemas.js';
import { upcomingItemSchema } from '../recurring/recurring.schemas.js';
import { isoDateSchema } from '../../shared/schemas.js';

export const monthKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês no formato YYYY-MM');
const money = z.string();
const pct = z.string();

export const monthQuerySchema = z.object({ month: monthKeySchema.optional() });
export const rangeQuerySchema = z
  .object({ from: monthKeySchema, to: monthKeySchema })
  .refine((q) => q.from <= q.to, { message: '`from` deve ser ≤ `to`', path: ['from'] });

export const safeToSpendSchema = z.object({
  month: z.string(),
  incomeSource: z.enum(['recurring', 'average_3m', 'fixed']),
  income: money,
  fixedExpenses: money,
  installments: money,
  otherScheduled: money,
  reserve: money,
  goalContributions: money,
  safetyMargin: money,
  discretionary: money,
  spentSoFar: money,
  remaining: money,
  daysLeft: z.number(),
  dailySafeAmount: money,
  disclaimer: z.string(),
});

export const dashboardSchema = z.object({
  month: z.string(),
  today: z.string(),
  balances: z.object({ current: money, investments: money, creditCardDebt: money, netWorth: money }),
  monthSummary: z.object({ income: money, expenses: money, net: money, savingsRate: pct }),
  available: z.object({ amount: money, lowestBalance: money, lowestDate: z.string() }),
  upcomingBills: z.object({ total: money, overdueCount: z.number(), items: z.array(upcomingItemSchema) }),
  upcomingInstallments: scheduleResponseSchema,
  creditCards: z.array(
    creditCardResponseSchema.pick({ id: true, name: true, color: true, availableLimit: true, creditLimit: true }).extend({
      currentInvoice: invoiceSummarySchema.nullable(),
      nextDueInvoice: invoiceSummarySchema.nullable(),
    }),
  ),
  safeToSpend: safeToSpendSchema,
  goals: z.array(goalResponseSchema),
});

export const monthlySeriesSchema = z.object({
  data: z.array(
    z.object({
      month: z.string(),
      income: money,
      expenses: money,
      net: money,
      savingsRate: pct,
      fixedIncome: money,
      variableIncome: money,
      recurringExpenses: money,
      installmentExpenses: money,
      essentialExpenses: money,
      endBalance: money.nullable(),
      endNetWorth: money.nullable(),
    }),
  ),
});

const categoryRow = z.object({
  categoryId: z.uuid().nullable(),
  name: z.string(),
  color: z.string().nullable(),
  icon: z.string().nullable(),
  isEssential: z.boolean(),
  total: money,
  count: z.number(),
  share: pct,
});

export const categoriesQuerySchema = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
    type: z.enum(['income', 'expense']).default('expense'),
    groupBy: z.enum(['parent', 'category']).default('parent'),
  })
  .refine((q) => q.from <= q.to, { message: '`from` deve ser ≤ `to`', path: ['from'] });

export const categoriesResponseSchema = z.object({ total: money, categories: z.array(categoryRow) });

export const balanceQuerySchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .refine((q) => q.from <= q.to, { message: '`from` deve ser ≤ `to`', path: ['from'] })
  .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 <= 731, 'Intervalo máximo de 2 anos');

export const balanceResponseSchema = z.object({ data: z.array(z.object({ date: z.string(), balance: money })) });

export const recurringSpendSchema = z.object({
  monthlyTotal: money,
  monthlyIncome: money,
  shareOfIncome: pct,
  items: z.array(
    z.object({
      id: z.uuid(),
      description: z.string(),
      categoryId: z.uuid().nullable(),
      accountName: z.string(),
      frequency: z.string(),
      amount: money,
      monthlyEquivalent: money,
      nextOccurrence: z.string().nullable(),
    }),
  ),
});

const expenseItem = z.object({
  id: z.uuid(),
  date: z.string(),
  description: z.string(),
  amount: money,
  categoryId: z.uuid().nullable(),
  categoryName: z.string().nullable(),
});

export const weeklyReportSchema = z.object({
  weekStart: z.string(),
  weekEnd: z.string(),
  income: money,
  expenses: money,
  net: money,
  topCategories: z.array(categoryRow),
  biggestExpenses: z.array(expenseItem),
  comparison: z.object({
    previousWeekExpenses: money,
    changeVsPreviousWeek: pct.nullable(),
    average4WeeksExpenses: money,
    changeVsAverage: pct.nullable(),
  }),
  previousWeeks: z.array(z.object({ weekStart: z.string(), income: money, expenses: money })),
});

export const monthlyReportSchema = z.object({
  month: z.string(),
  income: money,
  expenses: money,
  balance: money,
  savingsRate: pct,
  fixedIncome: money,
  variableIncome: money,
  essentialExpenses: money,
  lifestyleExpenses: money,
  byCategory: z.array(categoryRow.extend({ previous: money, changeVsPrevious: pct.nullable() })),
  comparison: z.object({
    previousMonth: z.string(),
    previousIncome: money,
    previousExpenses: money,
    incomeChange: pct.nullable(),
    expensesChange: pct.nullable(),
    previousSavingsRate: pct,
  }),
  biggestExpenses: z.array(expenseItem),
  insights: z.array(
    z.object({
      categoryId: z.uuid().nullable(),
      category: z.string(),
      current: money,
      average3m: money,
      changePercent: pct,
      message: z.string(),
    }),
  ),
});

export const yearlyReportSchema = z.object({
  year: z.number(),
  totalIncome: money,
  totalExpenses: money,
  balance: money,
  savingsRate: pct,
  totalInvested: money,
  monthlyAverageIncome: money,
  monthlyAverageExpenses: money,
  startNetWorth: money,
  endNetWorth: money,
  topCategories: z.array(categoryRow),
  bestMonth: z.string().nullable(),
  worstMonth: z.string().nullable(),
  months: monthlySeriesSchema.shape.data,
});

export const metricsSchema = z.object({
  month: z.string(),
  savingsMargin: z.object({ income: money, expenses: money, rate: pct }),
  burnRate: z.object({ monthly: money, runwayMonths: z.string().nullable() }),
  breakEven: z.object({ fixedCosts: money, averageVariable: money, requiredIncome: money, currentIncome: money, coverage: pct }),
  accumulatedExpenses: z.object({ monthToDate: money, yearToDate: money }),
  incomeCommitment: z.object({ fixedRecurring: money, installments: money, percent: pct }),
  averageSpending: z.object({ dailyThisMonth: money, monthlyLast6: money }),
  balanceProjection: z.object({
    current: money,
    endOfMonth: money.nullable(),
    in3Months: money.nullable(),
    in6Months: money.nullable(),
    withVariableSpending: z.object({ endOfMonth: money.nullable(), in3Months: money.nullable(), in6Months: money.nullable() }),
  }),
});

export const forecastQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(24).default(6),
  includeVariableAverage: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

export const forecastSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
  startBalance: money,
  includesVariableAverage: z.boolean(),
  days: z.array(z.object({ date: z.string(), balance: money, inflow: money, outflow: money })),
  months: z.array(
    z.object({
      month: z.string(),
      startBalance: money,
      income: money,
      expenses: money,
      cardInvoices: money,
      endBalance: money,
      lowestBalance: money,
      lowestDate: z.string(),
    }),
  ),
  events: z.array(
    z.object({
      date: z.string(),
      description: z.string(),
      amount: money,
      kind: z.enum(['pending', 'recurring', 'installment', 'invoice', 'variable']),
    }),
  ),
  summary: z.object({ endBalance: money, lowestBalance: money, lowestDate: z.string(), firstNegativeDate: z.string().nullable() }),
});
