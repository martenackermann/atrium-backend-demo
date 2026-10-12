import type { Seeder } from './seed-context';

/**
 * Seeder registry - executed in this order by `pnpm db:seed`.
 * Each module adds ONE line here pointing at `src/modules/<m>/seed/<m>.seed.ts`
 * (export `const <m>Seeder: Seeder`). `core` must stay first: other seeders
 * look up the personas it creates.
 *
 * @example
 * import { trainingSeeder } from '@/modules/training/seed/training.seed';
 * export const seeders: Seeder[] = [coreSeeder, trainingSeeder];
 */
export const seeders: Seeder[] = [];
