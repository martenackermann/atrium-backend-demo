import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';
import { createTestPrisma, databaseName, RUN_DB_MARKER, TEST_DATABASE_URL, withDatabase } from './test-database';

const PRISMA_CLI = join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
const STALE_AFTER_SECONDS = 3600;

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/**
 * Runs once before the e2e project:
 * 1. creates a fresh database `<base>_run_<epoch>` (nothing existing is modified),
 * 2. pushes prisma/schema into it (empty database -> no data-loss prompts),
 * 3. hands its URL to the test files (setup-e2e.ts sets DATABASE_URL),
 * and drops that run database again afterwards. Leftovers of crashed runs (same base,
 * older than an hour) are removed first.
 */
export default async function globalSetup(project: TestProject): Promise<() => Promise<void>> {
  const base = databaseName(TEST_DATABASE_URL);
  const runDb = `${base}${RUN_DB_MARKER}${Math.floor(Date.now() / 1000)}_${process.pid}`;
  const runUrl = withDatabase(TEST_DATABASE_URL, runDb);

  const admin = createTestPrisma(TEST_DATABASE_URL);
  try {
    const leftovers = await admin.$queryRaw<{ datname: string }[]>`
      SELECT datname FROM pg_database WHERE datname LIKE ${`${base}${RUN_DB_MARKER}%`}`;
    const now = Math.floor(Date.now() / 1000);
    for (const { datname } of leftovers) {
      const created = Number(/_run_(\d+)_/.exec(datname)?.[1] ?? now);
      if (now - created > STALE_AFTER_SECONDS)
        await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
    }
    await admin.$executeRawUnsafe(`CREATE DATABASE "${runDb}"`);
  } finally {
    await admin.$disconnect();
  }

  execFileSync(process.execPath, [PRISMA_CLI, 'db', 'push', '--url', runUrl], {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, DATABASE_URL: runUrl, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
  });
  project.provide('databaseUrl', runUrl);

  return async () => {
    const cleanup = createTestPrisma(TEST_DATABASE_URL);
    try {
      await cleanup.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${runDb}" WITH (FORCE)`);
    } finally {
      await cleanup.$disconnect();
    }
  };
}
