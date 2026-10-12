import 'dotenv/config';
import { faker } from '@faker-js/faker';
import { PrismaPg } from '@prisma/adapter-pg';
import { hashPassword } from '@/common/auth/password-hasher';
import { PrismaClient } from '@/generated/prisma/client';
import type { SeedContext } from './seed-context';
import { seeders } from './seeders';

export const SEED_MARKER_KEY = 'seed.completedAt';
const FAKER_SEED = 20261013;

/**
 * Seeds the database configured in DATABASE_URL.
 *   pnpm db:seed                      -> run every seeder (expects an empty database: use db:reset)
 *   node dist/database/seed/run.js --if-empty   -> skip when the seed marker exists (Docker first run)
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const ifEmpty = process.argv.includes('--if-empty');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const log = (message: string): void => console.log(`[seed] ${message}`);

  try {
    if (ifEmpty && (await prisma.systemSetting.findUnique({ where: { key: SEED_MARKER_KEY } }))) {
      log('database already seeded - skipping');
      return;
    }

    faker.seed(FAKER_SEED);
    const ctx: SeedContext = { prisma, faker, now: new Date(), hashPassword, log };
    for (const seeder of seeders) {
      const started = Date.now();
      await seeder.run(ctx);
      log(`${seeder.name} done in ${Date.now() - started} ms`);
    }

    const value = { at: new Date().toISOString(), seeders: seeders.map((s) => s.name) };
    await prisma.systemSetting.upsert({
      where: { key: SEED_MARKER_KEY },
      create: { key: SEED_MARKER_KEY, value },
      update: { value },
    });
    log(`completed (${seeders.length} seeders)`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
