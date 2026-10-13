import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { validateEnv } from '@/config/env.schema';
import { PrismaClient } from '@/generated/prisma/client';
import { truncateAll } from '../truncate';
import { isSeeded, runSeed } from './run-seed';

/**
 * Seed command line (DATABASE_URL from env / .env):
 *   tsx prisma/seed.ts              (pnpm db:seed)   seed an empty database
 *   ... --if-empty                  skip when already seeded (Docker first start)
 *   ... --reset                     truncate all tables first (pnpm demo:reset)
 */
export async function seedCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const env = validateEnv(process.env);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
  try {
    if (argv.includes('--reset')) {
      const tables = await truncateAll(prisma, { jobs: true });
      console.log(`[seed] truncated ${tables} tables`);
    } else if (argv.includes('--if-empty') && (await isSeeded(prisma))) {
      console.log('[seed] database already seeded - skipping');
      return;
    }
    await runSeed(prisma, { env });
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  seedCli().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
