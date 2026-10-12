import { beforeAll } from 'vitest';
import { createTestPrisma, truncateAll } from './test-database';

// Every e2e file starts from empty tables.
beforeAll(async () => {
  const prisma = createTestPrisma();
  try {
    await truncateAll(prisma);
  } finally {
    await prisma.$disconnect();
  }
});
