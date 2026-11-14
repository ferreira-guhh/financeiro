/**
 * Dados de demonstração: 6 meses de uso realista para explorar dashboard, relatórios e simulador.
 * Passa pela própria API (app.inject), então respeita todas as regras de negócio.
 *
 * Uso: npm run db:seed:demo   →  login: demo@financeiro.local / demo12345
 * Idempotente: se o usuário demo existir, ele é apagado e recriado.
 */
import { eq } from 'drizzle-orm';
import { buildApp } from '../app.js';
import { env } from '../config/env.js';
import { addDays, addMonths, addMonthsToKey, clampedDate, monthKey, parseMonth } from '../domain/dates.js';
import { today } from '../lib/clock.js';
import { users } from './schema.js';

const EMAIL = 'demo@financeiro.local';
const PASSWORD = 'demo12345';

/** PRNG determinístico (mulberry32): a demo é sempre igual para a mesma data. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const app = await buildApp({ ...env, NODE_ENV: 'test', AUTH_RATE_LIMIT_PER_MINUTE: 1000 });
  await app.db.delete(users).where(eq(users.email, EMAIL));

  const reg = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { name: 'Gustavo (demo)', email: EMAIL, password: PASSWORD } });
  const { token } = reg.json() as { token: string };

  const call = async (method: string, url: string, payload?: unknown) => {
    const res = await app.inject({ method: method as 'GET', url: `/api/v1${url}`, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined && { payload: payload as object }) });
    if (res.statusCode >= 400) throw new Error(`${method} ${url} → ${res.statusCode}: ${res.body}`);
    return res.body ? res.json() : null;
  };

  const cats = (await call('GET', '/categories')).data as { id: string; name: string }[];
  const cat = (name: string) => cats.find((c) => c.name === name)!.id;
  const random = rng(42);
  const between = (min: number, max: number) => (min + random() * (max - min)).toFixed(2);

  const now = today();
  const thisMonth = monthKey(now);
  const firstMonth = addMonthsToKey(thisMonth, -5);
  const day = (m: string, d: number) => {
    const [y, mo] = parseMonth(m);
    return clampedDate(y, mo, d);
  };

  // ─── Contas e cartão ───────────────────────────────────────────────────────
  const checking = await call('POST', '/accounts', { name: 'Nubank Conta', type: 'checking', initialBalance: '4200.00', color: '#8A05BE' });
  const savings = await call('POST', '/accounts', { name: 'Poupança Caixa', type: 'savings', initialBalance: '9500.00', color: '#0EA5E9' });
  await call('POST', '/accounts', { name: 'Carteira', type: 'wallet', initialBalance: '180.00', color: '#F59E0B' });
  const xp = await call('POST', '/accounts', { name: 'XP Investimentos', type: 'investment', initialBalance: '12000.00', color: '#111827' });
  const card = await call('POST', '/credit-cards', { name: 'Nubank Roxinho', creditLimit: '18000.00', closingDay: 3, dueDay: 10, paymentAccountId: checking.id, color: '#7C3AED' });

  await call('POST', '/category-rules', { categoryId: cat('Delivery'), pattern: 'IFOOD' });
  await call('POST', '/category-rules', { categoryId: cat('Aplicativos'), pattern: 'UBER' });
  await call('POST', '/category-rules', { categoryId: cat('Assinaturas'), pattern: 'NETFLIX' });

  const tx = (body: object) => call('POST', '/transactions', { accountId: checking.id, allowDuplicate: true, ...body });
  const buy = (body: object) => call('POST', `/credit-cards/${card.id}/purchases`, { allowDuplicate: true, ...body });

  // ─── Recorrências com histórico (backfill: meses passados entram como realizados) ─
  const start = `${firstMonth}-01`;
  const rec = (body: object) => call('POST', '/recurring', { accountId: checking.id, startDate: start, backfill: true, ...body });
  await rec({ type: 'income', amount: '8200.00', description: 'Salário ACME Ltda', dayOfMonth: 5, categoryId: cat('Salário'), autoConfirm: true });
  await rec({ type: 'expense', amount: '2200.00', description: 'Aluguel', dayOfMonth: 10, categoryId: cat('Aluguel'), paymentMethod: 'pix' });
  await rec({ type: 'expense', amount: '450.00', description: 'Condomínio', dayOfMonth: 10, categoryId: cat('Condomínio'), paymentMethod: 'bank_slip' });
  await rec({ type: 'expense', amount: '119.90', description: 'Internet Vivo Fibra', dayOfMonth: 15, categoryId: cat('Internet'), autoConfirm: true });
  await rec({ type: 'expense', amount: '190.00', description: 'Energia Enel (estimado)', dayOfMonth: 20, categoryId: cat('Energia') });
  await rec({ type: 'expense', amount: '389.00', description: 'Plano de saúde', dayOfMonth: 5, categoryId: cat('Plano de saúde'), autoConfirm: true });
  await rec({ accountId: card.accountId, type: 'expense', amount: '119.90', description: 'Smart Fit', dayOfMonth: 8, categoryId: cat('Lazer'), autoConfirm: true });
  await rec({ accountId: card.accountId, type: 'expense', amount: '21.90', description: 'Spotify', dayOfMonth: 18, categoryId: cat('Assinaturas'), startDate: addDays(now, 1), backfill: false });

  // ─── Variáveis dos meses anteriores ────────────────────────────────────────
  for (let m = firstMonth; m < thisMonth; m = addMonthsToKey(m, 1)) {
    if (random() > 0.5) await tx({ type: 'income', amount: between(600, 1800), date: day(m, 18), description: 'Projeto freelance', categoryId: cat('Freelance') });
    for (const d of [3, 11, 19, 26]) {
      await tx({ type: 'expense', amount: between(180, 360), date: day(m, d), description: 'Supermercado Pão de Açúcar', categoryId: cat('Supermercado'), paymentMethod: 'debit_card' });
    }
    await call('POST', '/transfers', { fromAccountId: checking.id, toAccountId: xp.id, amount: '1000.00', date: day(m, 6), description: 'Aporte mensal' });
  }

  // ─── Cartão: variáveis + assinaturas, de todos os meses até hoje ───────────
  for (let m = firstMonth; m <= thisMonth; m = addMonthsToKey(m, 1)) {
    const isCurrent = m === thisMonth;
    const limitDay = isCurrent ? Number(now.slice(8, 10)) : 28;
    // Delivery aumenta nos últimos meses (o relatório mensal deve apontar isso).
    const deliveries = m >= addMonthsToKey(thisMonth, -1) ? 7 : 4;
    for (let i = 0; i < deliveries; i++) {
      const d = 1 + Math.floor(random() * limitDay);
      await buy({ description: `IFOOD *${['BURGER KING', 'SUSHI LOKO', 'PIZZA HUT', 'MADERO'][i % 4]}`, amount: between(42, 95), date: day(m, d) });
    }
    for (let i = 0; i < 6; i++) {
      const d = 1 + Math.floor(random() * limitDay);
      await buy({ description: 'UBER *TRIP', amount: between(14, 42), date: day(m, d) });
    }
    if (limitDay >= 12) await buy({ description: 'NETFLIX.COM', amount: '55.90', date: day(m, 12) });
    if (limitDay >= 14) await buy({ description: 'Posto Shell', amount: between(180, 260), date: day(m, 14), categoryId: cat('Combustível') });
    if (limitDay >= 22 && random() > 0.4) await buy({ description: 'Outback Steakhouse', amount: between(160, 280), date: day(m, 22), categoryId: cat('Restaurantes') });
    if (limitDay >= 16 && random() > 0.5) await buy({ description: 'Drogasil', amount: between(35, 140), date: day(m, 16), categoryId: cat('Farmácia') });
  }

  // ─── Parcelamentos ─────────────────────────────────────────────────────────
  await buy({ description: 'MacBook Air', amount: '8400.00', installments: 12, date: addMonths(now, -3, 7), categoryId: cat('Compras') });
  await buy({ description: 'Geladeira Brastemp', amount: '3990.00', installments: 10, date: addDays(addMonths(now, -1), -3), categoryId: cat('Compras') });

  // Paga as faturas já vencidas (no vencimento).
  const invoices = (await call('GET', `/credit-cards/${card.id}/invoices`)).data as { year: number; month: number; dueDate: string; remaining: string }[];
  for (const inv of invoices) {
    if (inv.dueDate < now && Number(inv.remaining) > 0) {
      await call('POST', `/credit-cards/${card.id}/invoices/${inv.year}/${inv.month}/payments`, { date: inv.dueDate });
    }
  }

  // Mercado da semana atual e aporte do mês.
  for (const d of [3, 11]) {
    if (day(thisMonth, d) <= now) await tx({ type: 'expense', amount: between(180, 360), date: day(thisMonth, d), description: 'Supermercado Pão de Açúcar', categoryId: cat('Supermercado') });
  }
  if (day(thisMonth, 6) <= now) await call('POST', '/transfers', { fromAccountId: checking.id, toAccountId: xp.id, amount: '1000.00', date: day(thisMonth, 6), description: 'Aporte mensal' });

  // ─── Metas, investimentos e configurações ──────────────────────────────────
  await call('POST', '/goals', { name: 'Reserva de emergência', kind: 'emergency_reserve', targetAmount: '30000.00', linkedAccountId: savings.id, monthlyContribution: '500.00', expectedAnnualRate: '7.5' });
  await call('POST', '/goals', { name: 'Viagem ao Japão', kind: 'travel', targetAmount: '18000.00', initialAmount: '4000.00', monthlyContribution: '900.00', targetDate: addMonths(now, 14), color: '#EC4899' });
  await call('POST', '/goals', { name: 'Entrada do carro', kind: 'vehicle', targetAmount: '25000.00', initialAmount: '2500.00', monthlyContribution: '400.00', targetDate: addMonths(now, 30), expectedAnnualRate: '10' });

  await call('POST', '/investments', { name: 'CDB Banco Inter', type: 'cdb', investedAmount: '6000.00', currentAmount: '6612.40', investedAt: addMonths(now, -11), rateDescription: '110% do CDI', annualRate: '11.9', liquidityDays: 0, accountId: xp.id, objective: 'Reserva complementar' });
  await call('POST', '/investments', { name: 'Tesouro IPCA+ 2035', type: 'treasury', investedAmount: '5000.00', currentAmount: '5340.10', investedAt: addMonths(now, -8), rateDescription: 'IPCA + 6,1%', maturityDate: '2035-05-15', accountId: xp.id, objective: 'Aposentadoria' });
  await call('POST', '/investments', { name: 'FII HGLG11', type: 'reit', investedAmount: '3200.00', currentAmount: '3105.80', investedAt: addMonths(now, -5), liquidityDays: 2, objective: 'Renda passiva' });

  await call('PUT', '/settings', { incomeBasis: 'recurring', monthlyReserveAmount: '500.00', includeGoalContributions: true, safetyMarginPercent: '0' });
  await call('POST', '/processing/run');

  console.log(`✅ Demo criada. Login: ${EMAIL} / ${PASSWORD}`);
  await app.close();
}

await main();
