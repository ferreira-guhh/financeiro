import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './test/test-env.js';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
      JWT_SECRET: 'test-secret-test-secret-test-secret-test-secret',
      AUTH_RATE_LIMIT_PER_MINUTE: '10000',
      // Relógio congelado: testes determinísticos (é um domingo).
      APP_FIXED_DATE: '2026-11-15',
    },
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
