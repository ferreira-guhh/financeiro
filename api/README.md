# Financeiro API

Node 22 · TypeScript · Fastify 5 · Zod 4 · Drizzle ORM · PostgreSQL 16+ · Vitest

```bash
cp .env.example .env        # ajuste JWT_SECRET e DATABASE_URL
npm install
npm run db:migrate          # aplica src/db/migrations
npm run db:seed             # categorias padrão (idempotente)
npm run db:seed:demo        # opcional: usuário demo com 6 meses de dados
npm run dev                 # http://localhost:3333/api/v1
npm test                    # recria financeiro_test e roda unidade + e2e
```

Mudou o schema? `npm run db:generate -- --name descricao`, revise o SQL gerado e rode `npm run db:migrate`.

> Esta versão regenerou a migração inicial (`0000_init`). Se você chegou a rodar a da versão anterior, recrie o banco (`dropdb financeiro && createdb financeiro`) antes de migrar — ainda não havia dados reais.

## Estrutura

```
src/
├── app.ts · server.ts          # montagem do Fastify · servidor + agendador horário
├── config/env.ts               # variáveis validadas com Zod (falha no boot se inválidas)
├── db/                         # schema.ts (tabelas, enums, CHECKs) · client · seed · seed-demo · migrations/
├── domain/                     # REGRAS PURAS, sem banco nem HTTP — testadas isoladamente
│   ├── dates.ts                #   aritmética de datas contábeis (sem fuso)
│   ├── credit-card.ts          #   ciclo de fatura: fechamento, vencimento, status
│   ├── installments.ts         #   divisão em parcelas (centavos na 1ª)
│   ├── recurrence.ts           #   ocorrências de contas fixas
│   └── simulation/             #   juros compostos, inflação, metas, cenários (decimal.js)
├── lib/                        # money (BigInt), fingerprint (SHA-256), password (scrypt), clock
├── plugins/                    # database · auth (JWT) · audit · error-handler
├── shared/                     # AppError e schemas Zod reutilizáveis (dinheiro, datas, uuid)
├── modules/
│   ├── ledger/posting.ts       # PORTA ÚNICA do livro-caixa: sinal, fingerprint, vínculo com fatura
│   ├── auth · accounts · categories · transactions (inclui /transfers)
│   ├── credit-cards            # cartões, faturas, compras, pagamentos
│   ├── installment-plans · recurring · goals · investments · settings
│   ├── processing              # materializa parcelas/recorrências vencidas (idempotente)
│   ├── analytics               # dashboard, séries, relatórios, métricas, previsão, gasto seguro
│   ├── simulations             # rotas do simulador "E se?"
│   ├── category-rules          # regras de/para + cadeia de sugestão (ponto de extensão p/ IA)
│   └── imports                 # parsers CSV/OFX/XLSX → normalização → prévia → confirmação
└── integrations/bank-sync/     # contrato BankSyncProvider (Open Finance — Fase 7)
```

## Regras que o código garante

| Regra | Onde |
|---|---|
| Dinheiro em `NUMERIC(15,2)`, string na API; números JSON rejeitados | `shared/schemas.ts`, `lib/money.ts` |
| Entrada positiva, saída negativa; o banco rejeita sinal errado | `transactions_sign_chk` |
| Sem duplicidade, inclusive sob concorrência (`ON CONFLICT`) | `ledger/posting.ts` |
| Fingerprint calculado sobre a descrição original, nunca recalculado ao editar | idem |
| FITID único por conta | `transactions_account_fit_id_uq` |
| Parcelas e recorrências só viram lançamento no dia; gerar duas vezes não duplica | `installments.transaction_id` único, `transactions_recurrence_uq` + `FOR UPDATE` |
| Fatura fechada não aceita alteração (só estorno) | `transactions.service.ts` |
| Transferência = 2 pernas atômicas que somam zero | `createTransfer` |
| Nada é apagado: cancelar/arquivar | serviços |
| Isolamento entre usuários (404 para recurso alheio) | todas as consultas |

## Endpoints (`/api/v1`)

| Área | Rotas |
|---|---|
| Auth | `POST /auth/register` · `POST /auth/login` · `GET /auth/me` |
| Contas | `GET POST /accounts` · `GET PATCH DELETE /accounts/:id` |
| Categorias | `GET POST /categories` |
| Lançamentos | `GET POST /transactions` · `GET PATCH DELETE /transactions/:id` · `POST /transfers` |
| Cartões | `GET POST /credit-cards` · `GET PATCH DELETE /credit-cards/:id` · `POST /credit-cards/:id/purchases` · `GET /credit-cards/:id/invoices` · `GET /credit-cards/:id/invoices/:ano/:mes` · `POST …/payments` |
| Parcelamentos | `GET POST /installment-plans` · `GET /installment-plans/schedule` · `GET DELETE /installment-plans/:id` |
| Contas fixas | `GET POST /recurring` · `GET /recurring/upcoming` · `GET /recurring/suggestions` · `GET PATCH DELETE /recurring/:id` |
| Metas | `GET POST /goals` · `GET PATCH DELETE /goals/:id` · `GET POST /goals/:id/contributions` · `GET /goals/:id/projection` |
| Investimentos | `GET POST /investments` · `GET /investments/summary` · `GET PATCH DELETE /investments/:id` |
| Painel e análises | `GET /dashboard` · `/analytics/monthly` · `/analytics/categories` · `/analytics/balance` · `/analytics/recurring` |
| Relatórios | `GET /reports/weekly` · `/reports/monthly` · `/reports/yearly` · `GET /metrics` · `GET /forecast` · `GET /safe-to-spend` |
| Simulador | `POST /simulations/savings` · `POST /simulations/goal` · `GET /simulations/baseline` · `POST /simulations/scenario` |
| Importação | `POST /imports` (multipart) · `POST /imports/normalized` · `GET /imports` · `GET DELETE /imports/:id` · `PATCH /imports/:id/rows/:rowId` · `POST /imports/:id/confirm` |
| Regras | `GET POST /category-rules` · `POST /category-rules/test` · `POST /category-rules/apply` · `PATCH DELETE /category-rules/:id` |
| Outros | `GET PUT /settings` · `POST /processing/run` · `GET /audit-logs` |

Erros sempre no formato `{ "error": { "code", "message", "details?" } }`. Validação → 400; regra de negócio → 422; duplicata → 409 `DUPLICATE_TRANSACTION`.
