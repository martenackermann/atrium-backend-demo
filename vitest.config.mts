import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5432/atrium_test';

export default defineConfig({
  // SWC instead of esbuild: Nest DI needs emitDecoratorMetadata.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  resolve: {
    alias: [{ find: /^@\//, replacement: `${fileURLToPath(new URL('./src', import.meta.url))}/` }],
  },
  test: {
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: TEST_DATABASE_URL,
      JWT_SECRET: 'test-only-jwt-secret-with-at-least-32-chars',
      JWT_TTL_MINUTES: '60',
      FILE_SIGNING_SECRET: 'test-only-file-signing-secret',
      LOGIN_RATE_LIMIT: '1000',
      SMTP_HOST: process.env.TEST_SMTP_HOST ?? '127.0.0.1',
      SMTP_PORT: process.env.TEST_SMTP_PORT ?? '1025',
      API_PUBLIC_URL: 'http://localhost:3100',
      APP_BASE_URL: 'http://localhost:3000',
      CORS_ORIGINS: 'http://localhost:3000',
      APP_TIMEZONE: 'Europe/Berlin',
      DEMO_MODE: 'true',
      UPLOAD_MAX_BYTES: '1048576',
      SEED_FAKER_SEED: '4711',
      STORAGE_DIR: join(tmpdir(), 'atrium-test-storage'),
    },
    coverage: { provider: 'v8', include: ['src/**/*.ts'], exclude: ['src/generated/**', 'src/**/*.spec.ts'] },
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['src/**/*.spec.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['test/**/*.e2e-spec.ts'],
          globalSetup: ['test/support/global-setup.ts'],
          setupFiles: ['test/support/setup-e2e.ts'],
          // One shared database: run e2e files one after another.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
