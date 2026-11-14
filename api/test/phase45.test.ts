/**
 * Fase 4 (simulações) e Fase 5 (importação, regras, recorrências) + auditoria.
 * Relógio congelado em 2026-11-15.
 */
import ExcelJS from 'exceljs';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { suggestPattern, ruleMatches } from '../src/modules/category-rules/categorizer.js';
import { parseAmount, parseDate } from '../src/modules/imports/parsers/normalize.js';
import { parseOfx } from '../src/modules/imports/parsers/ofx.js';
import { parseCsv } from '../src/modules/imports/parsers/tabular.js';
import { categoryId, createAccount, newUser, ok, type Api } from './helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp(env);
});
afterAll(async () => {
  await app.close();
});

/** Monta um upload multipart à mão (sem dependências). */
async function upload(api: Api, accountId: string, fileName: string, content: Buffer | string, options?: object) {
  const boundary = '----financeiro' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  const field = (name: string, value: string) =>
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  field('accountId', accountId);
  if (options) field('options', JSON.stringify(options));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
  parts.push(typeof content === 'string' ? Buffer.from(content) : content);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return app.inject({
    method: 'POST',
    url: '/api/v1/imports',
    headers: { authorization: `Bearer ${api.token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat(parts),
  });
}

const OFX_1252 = Buffer.from(
  `OFXHEADER:100
DATA:OFXSGML
VERSION:102
ENCODING:USASCII
CHARSET:1252

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261110120000[-3:BRT]
<TRNAMT>-45.90
<FITID>202611100001
<MEMO>IFOOD *PEDIDO 8812
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261111
<TRNAMT>-23.50
<FITID>202611110002
<MEMO>PADARIA SÃO JOÃO
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261105
<TRNAMT>6000,00
<FITID>202611050003
<MEMO>SALARIO EMPRESA X
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`,
  'latin1',
);

describe('parsers (unidade)', () => {
  it('valores em formato BR e internacional', () => {
    expect(parseAmount('1.234,56')).toBe('1234.56');
    expect(parseAmount('-45,90')).toBe('-45.90');
    expect(parseAmount('R$ 1.234,56')).toBe('1234.56');
    expect(parseAmount('1,234.56')).toBe('1234.56');
    expect(parseAmount('(45,90)')).toBe('-45.90');
    expect(parseAmount('45,90 D')).toBe('-45.90');
    expect(parseAmount('45,90-')).toBe('-45.90');
    expect(parseAmount('1.234')).toBe('1234.00');
    expect(parseAmount('12.5')).toBe('12.50');
    expect(parseAmount(19.9)).toBe('19.90');
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('1,234')).toBeNull(); // vírgula com 3 casas: ambíguo, rejeita
  });

  it('datas em vários formatos', () => {
    expect(parseDate('15/11/2026')).toBe('2026-11-15');
    expect(parseDate('5/1/26')).toBe('2026-01-05');
    expect(parseDate('2026-11-15')).toBe('2026-11-15');
    expect(parseDate('11/15/2026', 'MM/DD/YYYY')).toBe('2026-11-15');
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseDate(46341)).toBe('2026-11-15'); // serial do Excel
  });

  it('OFX SGML em Windows-1252 com vírgula decimal', () => {
    const r = parseOfx(OFX_1252);
    expect(r.rows).toEqual([
      { date: '2026-11-10', amount: '-45.90', description: 'IFOOD *PEDIDO 8812', fitId: '202611100001' },
      { date: '2026-11-11', amount: '-23.50', description: 'PADARIA SÃO JOÃO', fitId: '202611110002' },
      { date: '2026-11-05', amount: '6000.00', description: 'SALARIO EMPRESA X', fitId: '202611050003' },
    ]);
  });

  it('CSV com ; e colunas de débito/crédito separadas', () => {
    const csv = 'Extrato conta\nData;Histórico;Débito;Crédito;Saldo\n01/11/2026;Conta de luz;189,90;;1.000,00\n02/11/2026;PIX recebido;;250,00;1.250,00\nSaldo final;;;;1.250,00\n';
    const r = parseCsv(Buffer.from(csv));
    expect(r.rows).toEqual([
      { date: '2026-11-01', amount: '-189.90', description: 'Conta de luz' },
      { date: '2026-11-02', amount: '250.00', description: 'PIX recebido' },
    ]);
  });

  it('regras e padrão sugerido', () => {
    expect(ruleMatches({ matchType: 'contains', pattern: '%ifood%' }, 'Ifood*Pedido 123')).toBe(true);
    expect(ruleMatches({ matchType: 'starts_with', pattern: 'uber' }, 'UBER *TRIP')).toBe(true);
    expect(ruleMatches({ matchType: 'regex', pattern: '^NETFLIX' }, 'netflix.com')).toBe(true);
    expect(suggestPattern('IFOOD*PEDIDO 1234')).toBe('IFOOD');
    expect(suggestPattern('PIX ENVIADO JOAO SILVA')).toBe('JOAO');
    expect(suggestPattern('COMPRA CARTAO DEB NETFLIX.COM 12/11')).toBe('NETFLIX.COM');
  });
});

describe('importação (fluxo completo)', () => {
  it('OFX: prévia → categoriza por regra → confirma → reimportar detecta duplicatas', async () => {
    const api = await newUser(app);
    const acc = await createAccount(api, { initialBalance: '0' });
    const alimentacao = await categoryId(api, 'Delivery');
    await ok(api('POST', '/category-rules', { categoryId: alimentacao, matchType: 'contains', pattern: '%IFOOD%' }), 201);

    const res = await upload(api, acc.id, 'extrato.ofx', OFX_1252);
    expect(res.statusCode).toBe(201);
    const preview = res.json();
    expect(preview.summary).toMatchObject({ new: 3, duplicate: 0, toImport: 3 });
    const ifood = preview.rows.find((r: any) => r.description.startsWith('IFOOD'));
    expect(ifood).toMatchObject({ suggestionSource: 'rule', categoryId: alimentacao });

    // Usuário corrige uma categoria manualmente → vira regra aprendida.
    const padaria = preview.rows.find((r: any) => r.description.startsWith('PADARIA'));
    await ok(api('PATCH', `/imports/${preview.id}/rows/${padaria.id}`, { categoryId: await categoryId(api, 'Restaurantes') }));

    // Nada no livro-caixa antes de confirmar.
    expect((await ok(api('GET', `/accounts/${acc.id}`))).balance).toBe('0.00');

    const done = await ok(api('POST', `/imports/${preview.id}/confirm`, { learnRules: true }));
    expect(done).toMatchObject({ imported: 3, skipped: 0, rulesCreated: 1 });
    expect((await ok(api('GET', `/accounts/${acc.id}`))).balance).toBe('5930.60');
    const { data: txs } = await ok(api('GET', '/transactions'));
    expect(txs.every((t: any) => t.source === 'import_ofx')).toBe(true);

    const rules = await ok(api('GET', '/category-rules'));
    expect(rules.data.map((r: any) => r.pattern)).toContain('PADARIA');

    // Reimportação do mesmo arquivo: tudo duplicado (FITID), nada novo.
    const again = (await upload(api, acc.id, 'extrato.ofx', OFX_1252)).json();
    expect(again.summary).toMatchObject({ duplicate: 3, toImport: 0 });
    expect(again.warnings[0]).toMatch(/já foi importado/);
    const second = await ok(api('POST', `/imports/${again.id}/confirm`, {}));
    expect(second).toMatchObject({ imported: 0, skipped: 3 });
  });

  it('CSV: concilia com lançamento pendente da recorrência e marca possível duplicata', async () => {
    const api = await newUser(app);
    const acc = await createAccount(api, { initialBalance: '0' });
    await ok(api('POST', '/recurring', { accountId: acc.id, type: 'expense', amount: '1500.00', description: 'Aluguel', dayOfMonth: 5, startDate: '2026-11-01' }), 201);
    await ok(api('POST', '/transactions', { accountId: acc.id, type: 'expense', amount: '230.45', date: '2026-11-12', description: 'Mercado' }), 201);

    const csv = 'Data,Descrição,Valor\n06/11/2026,TED ALUGUEL IMOBILIARIA,"-1.500,00"\n12/11/2026,SUPERMERCADO XYZ,"-230,45"\n14/11/2026,UBER *TRIP,"-18,20"\n';
    const preview = (await upload(api, acc.id, 'extrato.csv', csv)).json();
    expect(preview.rows.map((r: any) => [r.detection, r.action])).toEqual([
      ['reconcile', 'reconcile'],
      ['possible_duplicate', 'skip'],
      ['new', 'import'],
    ]);

    const done = await ok(api('POST', `/imports/${preview.id}/confirm`, {}));
    expect(done).toMatchObject({ imported: 1, reconciled: 1, skipped: 1 });
    const account = await ok(api('GET', `/accounts/${acc.id}`));
    expect(account).toMatchObject({ balance: '-1748.65', pendingAmount: '0.00' });
    const { data } = await ok(api('GET', '/transactions?search=Aluguel'));
    expect(data[0]).toMatchObject({ status: 'completed', date: '2026-11-06' });
  });

  it('Excel: lê a primeira aba e inverte sinal em fatura de cartão; categoriza pelo histórico', async () => {
    const api = await newUser(app);
    const checking = await createAccount(api);
    const card = await ok(api('POST', '/credit-cards', { name: 'Cartão XLS', creditLimit: '3000.00', closingDay: 3, dueDay: 10, paymentAccountId: checking.id }), 201);
    // Histórico: o usuário já categorizou "Uber" antes.
    await ok(api('POST', `/credit-cards/${card.id}/purchases`, { description: 'UBER *TRIP 1', amount: '10.00', date: '2026-11-04', categoryId: await categoryId(api, 'Aplicativos') }), 201);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Fatura');
    ws.addRow(['Fatura Novembro']);
    ws.addRow(['date', 'title', 'amount']);
    ws.addRow([new Date(Date.UTC(2026, 10, 12)), 'Uber *Trip 2', 25.5]);
    ws.addRow([new Date(Date.UTC(2026, 10, 13)), 'Livraria', 89.9]);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const preview = (await upload(api, card.accountId, 'fatura.xlsx', buffer)).json();
    expect(preview.source).toBe('xlsx');
    expect(preview.rows.map((r: any) => r.amount)).toEqual(['-25.50', '-89.90']);
    expect(preview.rows[0]).toMatchObject({ suggestionSource: 'history', suggestedCategoryId: await categoryId(api, 'Aplicativos') });

    await ok(api('POST', `/imports/${preview.id}/confirm`, {}));
    const inv = await ok(api('GET', `/credit-cards/${card.id}/invoices/2026/12`));
    expect(inv.total).toBe('125.40'); // 10 + 25,50 + 89,90
  });

  it('transações normalizadas (porta do Open Finance) e descarte de prévia', async () => {
    const api = await newUser(app);
    const acc = await createAccount(api);
    const preview = await ok(
      api('POST', '/imports/normalized', {
        accountId: acc.id,
        transactions: [
          { date: '2026-11-10', amount: '-10.00', description: 'Café', fitId: 'prov-1' },
          { date: '2026-11-10', amount: '-10.00', description: 'Café', fitId: 'prov-2' },
        ],
      }),
      201,
    );
    expect(preview.source).toBe('open_finance');
    expect(preview.summary.toImport).toBe(2); // dois cafés idênticos e legítimos no mesmo dia
    await ok(api('DELETE', `/imports/${preview.id}`), 204);
    expect((await api('POST', `/imports/${preview.id}/confirm`, {})).statusCode).toBe(422);
  });

  it('erros claros para arquivo ilegível', async () => {
    const api = await newUser(app);
    const acc = await createAccount(api);
    const res = await upload(api, acc.id, 'x.csv', 'foo,bar\n1,2\n');
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/colunas de data e valor/);
  });
});

describe('regras de categorização', () => {
  it('testa, aplica às transações sem categoria e rejeita regex inválida', async () => {
    const api = await newUser(app);
    const acc = await createAccount(api);
    await ok(api('POST', '/transactions', { accountId: acc.id, type: 'expense', amount: '39.90', date: '2026-11-10', description: 'NETFLIX.COM' }), 201);
    expect((await api('POST', '/category-rules', { categoryId: await categoryId(api, 'Assinaturas'), matchType: 'regex', pattern: '([' })).statusCode).toBe(400);
    await ok(api('POST', '/category-rules', { categoryId: await categoryId(api, 'Assinaturas'), matchType: 'regex', pattern: '^NETFLIX' }), 201);
    const t = await ok(api('POST', '/category-rules/test', { description: 'netflix.com 11/26' }));
    expect(t.matched.pattern).toBe('^NETFLIX');
    expect(await ok(api('POST', '/category-rules/apply'))).toEqual({ scanned: 1, categorized: 1 });
  });
});

describe('simulações "E se?"', () => {
  it('quanto terei economizando R$ 300 por mês durante 2 anos', async () => {
    const api = await newUser(app);
    const r = await ok(api('POST', '/simulations/savings', { monthlyContribution: '300.00', months: 24, annualRatePercent: '10', annualInflationPercent: '4.5' }));
    expect(r.months).toHaveLength(24);
    expect(r.months[0].month).toBe('2026-12');
    expect(r.summary.totalContributed).toBe('7200.00');
    expect(Number(r.summary.finalBalance)).toBeGreaterThan(7900);
    expect(Number(r.summary.finalRealBalance)).toBeLessThan(Number(r.summary.finalBalance));
  });

  it('cortar R$ 150 de delivery antecipa a meta', async () => {
    const api = await newUser(app);
    const goal = await ok(api('POST', '/goals', { name: 'Notebook', targetAmount: '6000.00', monthlyContribution: '500.00', targetDate: '2027-10-31' }), 201);
    const r = await ok(api('POST', '/simulations/goal', { goalId: goal.id, extraMonthly: '150.00' }));
    expect(r).toMatchObject({ goalName: 'Notebook', monthsSaved: -2, requiredForTargetDate: '500.00' });
    expect(r.baseline.months).toBe(12);
    expect(r.withExtra.months).toBe(10);
  });

  it('cenário com dados reais: nova compra parcelada e aumento de renda', async () => {
    const api = await newUser(app);
    const acc = await createAccount(api, { initialBalance: '1000.00' });
    await ok(api('POST', '/recurring', { accountId: acc.id, type: 'income', amount: '5000.00', description: 'Salário', dayOfMonth: 5, startDate: '2026-12-01' }), 201);
    await ok(api('POST', '/recurring', { accountId: acc.id, type: 'expense', amount: '3000.00', description: 'Fixas', dayOfMonth: 10, startDate: '2026-12-01' }), 201);

    const base = await ok(api('GET', '/simulations/baseline?months=12'));
    expect(base).toMatchObject({ startingBalance: '1000.00', monthlyIncome: '5000.00', monthlyFixedExpenses: '3000.00' });

    const r = await ok(
      api('POST', '/simulations/scenario', {
        months: 12,
        adjustments: {
          newInstallmentPurchases: [{ label: 'Celular', totalAmount: '2400.00', installments: 12 }],
          incomeChange: { percent: '10', startMonth: '2027-06' },
        },
      }),
    );
    expect(r.months[0]).toMatchObject({ baselineNet: '2000.00', scenarioNet: '1800.00' });
    expect(r.months[7]).toMatchObject({ scenarioIncome: '5500.00', scenarioNet: '2300.00' });
    expect(r.summary.difference).toBe('100.00'); // −200 × 12 + 500 × 5 (jun–out/2027)
  });
});

describe('auditoria', () => {
  it('registra operações de escrita, sem guardar o corpo', async () => {
    const api = await newUser(app);
    const acc = await createAccount(api);
    const { data } = await ok(api('GET', '/audit-logs'));
    expect(data[0]).toMatchObject({ action: 'POST /api/v1/accounts', entityId: acc.id, statusCode: 201 });
    expect(data.map((d: any) => d.action)).toContain('POST /api/v1/auth/register');
  });
});
