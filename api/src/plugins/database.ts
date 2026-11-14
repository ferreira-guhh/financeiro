import fp from 'fastify-plugin';
import { createDatabase, type Database } from '../db/client.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
  }
}

export const databasePlugin = fp<{ connectionString: string }>(
  async (app, { connectionString }) => {
    const { db, pool } = createDatabase(connectionString);
    app.decorate('db', db);
    app.addHook('onClose', async () => {
      await pool.end();
    });
  },
  { name: 'database' },
);
