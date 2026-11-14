// Aplica as migrações pendentes sem depender do drizzle-kit (que é dependência
// de desenvolvimento). Usado no start de produção: `npm run start:prod`.
import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL não definida');
  process.exit(1);
}

// Funciona tanto de src/db (tsx) quanto de dist/db (build): ambos apontam para api/src/db/migrations.
const migrationsFolder = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));

const pool = new pg.Pool({ connectionString, max: 1 });
try {
  await migrate(drizzle({ client: pool }), { migrationsFolder });
  console.log('✅ Migrações aplicadas');
} catch (err) {
  console.error('❌ Falha ao aplicar migrações:', err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
