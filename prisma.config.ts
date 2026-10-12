import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx src/database/seed/run.ts',
  },
  datasource: {
    // Not every command needs a database (e.g. `prisma generate`), so fall back to
    // an empty string instead of failing at config load time.
    url: process.env.DATABASE_URL ?? '',
  },
});
