import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { createTestPrisma, TEST_DATABASE_URL, truncateAll } from './test-database';

const PRISMA_CLI = join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');

/**
 * Runs once before the e2e project:
 * 1. empties the test database (public tables + queued pg-boss jobs),
 * 2. syncs the schema from prisma/schema with `prisma db push` (no migrations needed;
 *    tables are empty, so column changes apply without data-loss prompts).
 * Each test file additionally truncates in its own beforeAll (setup-e2e.ts).
 */
export default async function globalSetup(): Promise<void> {
  const prisma = createTestPrisma();
  try {
    await truncateAll(prisma, { jobs: true });
  } finally {
    await prisma.$disconnect();
  }

  execFileSync(process.execPath, [PRISMA_CLI, 'db', 'push', '--url', TEST_DATABASE_URL], {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
  });
}
