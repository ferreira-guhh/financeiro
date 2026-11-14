/** Banco exclusivo para testes — é APAGADO e recriado a cada execução. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/financeiro_test';
