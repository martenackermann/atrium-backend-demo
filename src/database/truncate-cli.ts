import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { truncateAll } from './truncate';

/** `pnpm db:truncate` - first step of `db:reset`: empties all tables of DATABASE_URL. */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const count = await truncateAll(prisma, { jobs: true });
    console.log(`[truncate] emptied ${count} tables in ${new URL(url).pathname.slice(1)}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
