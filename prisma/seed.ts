/**
 * `prisma db seed` / `pnpm db:seed` entry point. Seeds core first, then discovers every
 * module's `src/modules/<m>/seed/*.seed.ts` (see src/database/seed/run-seed.ts).
 * Pass --reset to truncate first (`pnpm demo:reset`).
 */
import { seedCli } from '../src/database/seed/cli';

seedCli().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
