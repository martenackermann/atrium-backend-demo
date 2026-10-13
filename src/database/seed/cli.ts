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
 * Refused with NODE_ENV=production and DEMO_MODE=false (the personas share a public password).
 *   ... --reset                     truncate all tables first (pnpm demo:reset)
 */
export async function seedCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const env = validateEnv(process.env);
  if (env.NODE_ENV === 'production' && !env.DEMO_MODE) {
    // The demo data lets every persona (it_admin included) sign in with the public password demo1234.
    const message = '[seed] demo data is not seeded with NODE_ENV=production and DEMO_MODE=false';
    if (argv.includes('--if-empty')) {
      console.warn(`${message} - skipping (Docker first start)`);
      return;
    }
    throw new Error(message);
  }
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
