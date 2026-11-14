import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { seedSystemCategories } from '../src/db/seed.js';
import * as schema from '../src/db/schema.js';
import { TEST_DATABASE_URL } from './test-env.js';

/** Recria o banco de testes do zero, aplica as migrações reais e o seed. */
export default async function setup() {
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(dbName) || !dbName.endsWith('_test')) {
    throw new Error(`Recuso-me a recriar "${dbName}": o nome do banco de testes deve terminar em _test`);
  }

  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();

  const pool = new pg.Pool({ connectionString: url.toString() });
  const db = drizzle({ client: pool, schema, casing: 'snake_case' });
  await migrate(db, { migrationsFolder: './src/db/migrations' });
  await seedSystemCategories(db);
  await pool.end();
}
