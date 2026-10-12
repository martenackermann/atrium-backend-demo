import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

export { truncateAll } from '@/database/truncate';

/** Local default: the shared dev Postgres. CI sets TEST_DATABASE_URL. */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://dev:dev@localhost:5432/atrium_test';

export function createTestPrisma(url = TEST_DATABASE_URL): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}
