import { buildApp } from './app.js';
import { env } from './config/env.js';
import { processAllUsers } from './modules/processing/processing.module.js';

const app = await buildApp(env);

// Agendador: materializa parcelas e recorrências que venceram (idempotente).
const PROCESSING_INTERVAL_MS = 60 * 60 * 1000;
async function runProcessing() {
  try {
    const result = await processAllUsers(app.db);
    if (result.installmentsPosted || result.recurringGenerated) app.log.info(result, 'Processamento concluído');
  } catch (err) {
    app.log.error({ err }, 'Falha no processamento agendado');
  }
}
const timer = setInterval(() => void runProcessing(), PROCESSING_INTERVAL_MS);
timer.unref();
app.addHook('onReady', async () => void runProcessing());

const shutdown = async (signal: string) => {
  app.log.info(`${signal} recebido, encerrando...`);
  clearInterval(timer);
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
