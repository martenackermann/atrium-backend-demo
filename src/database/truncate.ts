import type { PrismaClient } from '@/generated/prisma/client';
import { PG_BOSS_SCHEMA } from '@/infra/queue/queue.constants';

/**
 * Empties every table in the public schema (keeps the schema and migration history) and
 * drops queued pg-boss jobs. Used by `pnpm db:reset` / `demo:reset` and the e2e tests.
 * Never point this at a database you care about.
 */
export async function truncateAll(prisma: PrismaClient, options: { jobs?: boolean } = {}): Promise<number> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length > 0) {
    const list = tables.map(({ tablename }) => `"public"."${tablename.replace(/"/g, '""')}"`).join(', ');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }
  if (options.jobs) {
    await prisma.$executeRawUnsafe(
      `DO $$ BEGIN IF to_regclass('${PG_BOSS_SCHEMA}.job') IS NOT NULL THEN DELETE FROM ${PG_BOSS_SCHEMA}.job; END IF; END $$`,
    );
  }
  return tables.length;
}
