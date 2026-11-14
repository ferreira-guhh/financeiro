# Financeiro — gerenciador financeiro pessoal

Livro-caixa com contas, cartões, parcelamentos, contas fixas, metas, investimentos, dashboard, relatórios, previsão de caixa, simulador "E se?" e importação de extratos — construído a partir do seu planejamento consolidado, nas fases 1 a 5. As fases 6 (IA) e 7 (Open Finance) ficaram **preparadas na arquitetura, não implementadas**, como o próprio plano determina ("não implementar IA ou integração bancária antes de o núcleo financeiro estar estável").

```
financeiro/
├── api/   Node 22 · TypeScript · Fastify 5 · Zod 4 · Drizzle ORM · PostgreSQL   (README próprio)
└── web/   React 19 · Vite · TypeScript · Tailwind 4 · Recharts · TanStack Query
```

## Como rodar

Pré-requisitos: Node 22+ e PostgreSQL 16+ (ou Docker).

```bash
npm run setup          # instala api/ e web/, cria api/.env
npm run db:up          # sobe o Postgres via docker compose (pule se já tiver um)
npm run db:migrate     # cria as tabelas e as categorias padrão
npm run db:demo        # opcional: 6 meses de dados de exemplo
npm run api            # terminal 1 → http://localhost:3333
npm run web            # terminal 2 → http://localhost:5173
```

Com a demo: entre com `demo@financeiro.local` / `demo12345`. Sem ela, crie sua conta na tela de login.

Testes: `npm test` (82 testes, contra um Postgres real — o banco `financeiro_test` é recriado a cada execução).
Backup: `DATABASE_URL=... api/scripts/backup.sh` (pg_dump com retenção; instruções de restauração no arquivo). No Windows, rode pelo Git Bash ou WSL.

## Seu planejamento → o que foi construído

| Seção do plano | Onde está | Observação |
|---|---|---|
| **3.1 Livro-caixa** (valor, data, descrição, categoria, conta, cartão, tipo, forma de pagamento, status, observação) | `Lançamentos` · `api/modules/transactions` | Todos os campos. "Cartão" é a conta do cartão (ver adaptações). |
| Receitas fixas × variáveis | `Relatórios → Mensal` | Fixa = veio de uma conta fixa cadastrada; variável = o resto. |
| Despesas essenciais × estilo de vida | categorias com `is_essential` | Separadas no relatório mensal. |
| **4. Contas e cartões** (limite, disponível, fechamento, vencimento, fatura atual e futuras) | `Contas`, `Cartões` | Limite disponível já desconta parcelas futuras, como o banco faz. |
| **5. Parcelamentos** (total, quantidade, parcela, data inicial/final, parcela atual) | `Parcelamentos` · `domain/installments.ts` | R$ 3.600 em 12× = 12 de R$ 300; centavos de sobra vão na 1ª parcela. Aceita parcela com juros. |
| **6. Contas recorrentes** (gerar ou prever) | `Contas fixas` · `domain/recurrence.ts` | Gera no dia como "a confirmar" (ou já realizado, se for débito automático) e projeta os próximos meses. |
| **7. Importação** CSV, OFX, Excel | `Importar extrato` · `modules/imports` | Fluxo exato do plano: upload → processamento → identificação → categorização → **confirmação** → banco. |
| Duplicadas · descrições semelhantes · sugestão de categoria · recorrentes | idem | FITID + fingerprint; "talvez duplicada" por valor e data próxima; regras + histórico; detector de recorrências no histórico. |
| Pronto para Open Finance | `api/src/integrations/bank-sync` | Toda fonte gera o mesmo `NormalizedTransaction`; um provedor só precisa implementar a interface. |
| **8. Dashboard** (saldo, receitas/despesas do mês, investimentos, disponível, contas futuras, parcelas futuras, fatura, taxa de poupança) | `Painel` | Todos os indicadores. |
| Gráficos (fluxo de caixa, categoria, evolução do saldo, receitas × despesas, evolução mensal, recorrentes) | `Painel`, `Relatórios`, `Previsão`, `/analytics/*` | |
| **9. Relatórios** semanais, mensais, anuais | `Relatórios` | Com comparação com períodos anteriores. |
| Métricas (margem de poupança, burn rate, ponto de equilíbrio, despesas acumuladas, comprometimento da renda, média de gastos, projeção de saldo) | `Relatórios → Indicadores` · `/metrics` | Todas as sete. |
| **10. Simulações "E se?"** (aportes, juros compostos, rendimento, inflação, cortes, aumento de renda, parcelados, novas recorrentes, metas) | `Simulador` · `api/src/domain/simulation` | Camada separada e pura, como pedido. Recalcula enquanto você digita. |
| **11. Margem discricionária / gasto seguro** | herói do `Painel` · `Configurações` | Seu exemplo: 5.000 − 2.500 − 500 − 700 = **1.300** (há um teste com exatamente esses números). Configurável e com aviso de que não é recomendação. |
| **12. Metas** (quanto falta, quanto guardar por mês, previsão, impacto de mudar aportes) | `Metas` | Com rendimento opcional e tabela de "e se eu aportar ±25%". |
| **13. IA** | ver "Fases 6 e 7" abaixo | Antecipei a parte determinística: "Seus gastos com Alimentação aumentaram 38% em relação à média dos últimos 3 meses" já aparece no relatório mensal, sem ML. |
| **14. Investimentos** (tipo, valor, data, rentabilidade, liquidez, objetivo, prazo) | `Investimentos` | Só registro e organização, **sem recomendações**, como pedido. |
| **16. Segurança** | ver abaixo | |

## O que adaptei do seu esquema (e por quê)

1. **Prisma → Drizzle ORM.** O Drizzle permite declarar no próprio schema os `CHECK` constraints que protegem os dados (ex.: despesa nunca pode ter valor positivo) e devolve `NUMERIC` como string, nunca como float. O Prisma não modela isso.
2. **Supabase não foi usado.** Autenticação e banco são próprios (JWT + scrypt + PostgreSQL puro). Nada impede apontar `DATABASE_URL` para um Postgres do Supabase depois.
3. **Cartão de crédito é uma conta do tipo "cartão".** As compras entram nela; pagar a fatura é uma transferência da conta corrente para o cartão. Assim a mesma compra nunca é contada duas vezes como despesa (na compra e no pagamento), e o patrimônio líquido é só a soma dos saldos.
4. **"Investimentos" não é uma categoria de despesa.** Seu plano listava "Investimentos" entre as despesas. Aqui, aplicar dinheiro é uma *transferência* para uma conta de investimento. Se fosse despesa, a taxa de poupança cairia justamente quando você investe. O "total investido" do relatório anual vem dessas transferências.
5. **Total e status da fatura não são gravados**, são sempre calculados a partir dos lançamentos. Uma fatura nunca fica com total diferente das compras dela.
6. **Nada é apagado.** Lançamentos viram "cancelados" e contas viram "arquivadas"; o histórico fica íntegro.
7. **Compras em fatura já fechada não podem ser editadas nem canceladas.** É preciso lançar um estorno, como no banco.

## Segurança (seção 16 do plano)

- **Senhas:** nenhuma senha ou credencial bancária é pedida ou guardada. A senha do app é guardada com scrypt.
- **Autenticação:** JWT; login e cadastro com limite de tentativas por minuto.
- **Validação:** todas as entradas passam por Zod; o banco tem constraints como última linha de defesa.
- **Controle de acesso:** todas as consultas filtram pelo usuário; recurso de outro usuário responde 404.
- **Registro de operações:** toda escrita fica em `audit_logs` (rota, entidade, IP, data, sem o corpo da requisição), visível em Configurações. Falhas de login também são registradas.
- **Variáveis de ambiente:** as credenciais ficam só no `.env`. Backup em `api/scripts/backup.sh`.
- **Criptografia (pendente):** quando houver dado sensível a guardar (ex.: id de conexão do Open Finance), criptografar com AES-256-GCM. Hoje não há nenhum.

## Fases 6 e 7: o que está preparado

- **IA (Fase 6).** A categorização passa por uma cadeia de `CategorySuggester` (`api/src/modules/category-rules/categorizer.ts`): primeiro as regras do usuário, depois o histórico. O classificador em Python/FastAPI entra como mais um elo dessa cadeia, sem mudar a importação. As correções feitas na revisão já viram regras ("aprender com minhas correções"); esse mesmo histórico serve de dado de treino.
- **Open Finance (Fase 7).** `api/src/integrations/bank-sync/provider.ts` define `BankSyncProvider`. Um provedor Pluggy ou Belvo traduz a API dele para `NormalizedTransaction`, e `syncAccount()` reaproveita todo o pipeline: duplicidade, conciliação, categorização, prévia e confirmação. O endpoint `POST /api/v1/imports/normalized` já recebe transações nesse formato.

## Limitações conhecidas

- **Moeda:** uma só por transferência (BRL ↔ BRL); não há câmbio.
- **Parcelas em extrato importado:** linhas como "PARCELA 3/12" num CSV/OFX de cartão entram como lançamentos avulsos, sem virar parcelamento.
- **Sessão:** só access token, sem refresh token com rotação.
