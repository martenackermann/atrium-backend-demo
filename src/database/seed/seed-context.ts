import type { Faker } from '@faker-js/faker';
import type { PrismaClient } from '@/generated/prisma/client';

/** Literal password of every demo persona. Demo only - documented in README. */
export const DEMO_PASSWORD = 'demo1234';

/** Everything a seeder needs. Seeders are plain functions: no Nest DI. */
export interface SeedContext {
  prisma: PrismaClient;
  /** English faker with a fixed seed, so demo data is reproducible. */
  faker: Faker;
  /** Reference "now" for relative dates (e.g. trainings next month). */
  now: Date;
  hashPassword: (plain: string) => Promise<string>;
  log: (message: string) => void;
}

export interface Seeder {
  /** Module name, e.g. "training". */
  name: string;
  run: (ctx: SeedContext) => Promise<void>;
}
