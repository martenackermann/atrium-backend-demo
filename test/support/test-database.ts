import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

export { truncateAll } from '@/database/truncate';

/**
 * Base test database (`atrium_test` by default, `TEST_DATABASE_URL` to override - slices use
 * their own `atrium_aN_test`). Each e2e run creates a fresh, empty database next to it
 * (`<base>_run_<time>`), so schema changes never need destructive `db push` flags.
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5432/atrium_test';

export const RUN_DB_MARKER = '_run_';

export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.slice(1));
}

export function createTestPrisma(url = process.env.DATABASE_URL ?? TEST_DATABASE_URL): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}
