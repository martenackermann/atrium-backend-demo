import type { Faker } from '@faker-js/faker';
import type { AttachmentPurpose } from '@/common/domain/vocabulary';
import type { IsoDate } from '@/common/time/time';
import type { Env } from '@/config/env.schema';
import type { PrismaClient } from '@/generated/prisma/client';

/** Literal password of every seeded user. Demo only - documented in README. */
export const DEMO_PASSWORD = 'demo1234';

/**
 * Everything a seeder needs (SPEC §10). Seeders are plain functions - no Nest DI - so they
 * run from `pnpm db:seed`, from Docker's first start and from the `demo.reset` job.
 */
export interface SeedContext {
  prisma: PrismaClient;
  /** faker (locale en) seeded with SEED_FAKER_SEED - output is deterministic. */
  faker: Faker;
  /** SEED_TODAY (default: today in APP_TIMEZONE). */
  today: IsoDate;
  /** `d(-3)` = today - 3 days, as IsoDate (SPEC "d±n"). */
  d: (offsetDays: number) => IsoDate;
  /** Instant at local time `hh:mm` (APP_TIMEZONE) on day `d(offsetDays)`. */
  at: (offsetDays: number, hh?: number, mm?: number) => Date;
  /** Deterministic UUIDv7 for a record created at `createdAt` (SPEC §10). */
  uuid: (createdAt: Date) => string;
  /** argon2id hash of DEMO_PASSWORD (computed once). */
  demoPasswordHash: string;
  /** Validated environment (mailboxes, thresholds...). */
  env: Env;
  /** Users by persona key and by email, filled by the core seeder. */
  users: SeedUsers;
  /** Writes a file into STORAGE_DIR and creates its Attachment row (linked when `entity` is given). */
  storeFile: (input: SeedFileInput) => Promise<{ id: string; storageKey: string }>;
  log: (message: string) => void;
}

export interface SeedUserRef {
  id: string;
  email: string;
  displayName: string;
  managerId: string | null;
}

export interface SeedUsers {
  byPersona: Map<string, SeedUserRef>;
  byEmail: Map<string, SeedUserRef>;
  /** Persona or email lookup that throws when missing. */
  get(keyOrEmail: string): SeedUserRef;
}

export interface SeedFileInput {
  content: Buffer;
  originalName: string;
  mimeType: string;
  purpose: AttachmentPurpose;
  uploadedById: string;
  createdAt: Date;
  entity?: { type: string; id: string };
}

/**
 * A module's seed step: `src/modules/<m>/seed/<name>.seed.ts` exports
 * `export const seeder: Seeder = { name: '...', run: async (ctx) => {...} }`.
 * Files are discovered automatically and run module by module (SEED_MODULE_ORDER),
 * file name order within a module.
 */
export interface Seeder {
  name: string;
  run: (ctx: SeedContext) => Promise<void>;
}

/** Module order for seeding: core first (org, users), then the slices. */
export const SEED_MODULE_ORDER = ['core', 'training', 'travel', 'assets', 'people', 'news', 'home'] as const;
