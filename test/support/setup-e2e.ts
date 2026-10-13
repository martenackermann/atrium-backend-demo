import { beforeAll, inject } from 'vitest';
import { createTestPrisma, truncateAll } from './test-database';

// The per-run database created by global-setup.ts. Set before any test file imports AppModule.
process.env.DATABASE_URL = inject('databaseUrl');

// Every e2e file starts from empty tables.
beforeAll(async () => {
  const prisma = createTestPrisma();
  try {
    await truncateAll(prisma, { jobs: true });
  } finally {
    await prisma.$disconnect();
  }
});
