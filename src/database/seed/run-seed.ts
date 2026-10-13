import { existsSync, readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { type Faker, faker } from '@faker-js/faker';
import { v7 as uuidv7 } from 'uuid';
import { hashPassword } from '@/common/auth/password-hasher';
import { addDaysIso, isoDateInZone, startOfDayInZone } from '@/common/time/time';
import type { Env } from '@/config/env.schema';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  DEMO_PASSWORD,
  SEED_MODULE_ORDER,
  type SeedContext,
  type Seeder,
  type SeedFileInput,
  type SeedUserRef,
} from './seed-context';

export const SEED_MARKER_KEY = 'seed.completedAt';

/** Deterministic UUIDv7: timestamp from `createdAt`, random bits from the seeded faker (SPEC §10). */
export function seededUuidFactory(f: Faker): (createdAt: Date) => string {
  return (createdAt) =>
    uuidv7({
      msecs: createdAt.getTime(),
      random: Uint8Array.from({ length: 16 }, () => f.number.int({ min: 0, max: 255 })),
    });
}

function isSeeder(value: unknown): value is Seeder {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Seeder).name === 'string' &&
    typeof (value as Seeder).run === 'function'
  );
}

/** Finds `src/modules/<m>/seed/*.seed.(ts|js)` (or dist equivalents) in module order. */
export async function discoverSeeders(
  modulesRoot = resolve(__dirname, '..', '..', 'modules'),
): Promise<{ module: string; file: string; seeder: Seeder }[]> {
  const found: { module: string; file: string; seeder: Seeder }[] = [];
  for (const module of SEED_MODULE_ORDER) {
    const dir = join(modulesRoot, module, 'seed');
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir)
      .filter((f) => /\.seed\.(ts|js)$/.test(f) && !f.endsWith('.d.ts'))
      .sort();
    for (const file of files) {
      const exports = (await import(pathToFileURL(join(dir, file)).href)) as Record<string, unknown>;
      for (const value of Object.values(exports)) {
        if (isSeeder(value)) found.push({ module, file, seeder: value });
      }
    }
  }
  return found;
}

export interface RunSeedOptions {
  env: Env;
  log?: (message: string) => void;
  /** Only seed these modules (tests seed just `core`). Default: all. */
  modules?: readonly string[];
}

/** Runs every seeder against an empty database and writes the seed marker. */
export async function runSeed(prisma: PrismaClient, options: RunSeedOptions): Promise<void> {
  const { env } = options;
  const log = options.log ?? ((message: string) => console.log(`[seed] ${message}`));
  faker.seed(env.SEED_FAKER_SEED);
  const today = env.SEED_TODAY || isoDateInZone(new Date(), env.APP_TIMEZONE);
  const storageRoot = resolve(env.STORAGE_DIR);

  const byPersona = new Map<string, SeedUserRef>();
  const byEmail = new Map<string, SeedUserRef>();

  const ctx: SeedContext = {
    prisma,
    faker,
    today,
    d: (offset) => addDaysIso(today, offset),
    at: (offset, hh = 9, mm = 0) =>
      new Date(startOfDayInZone(addDaysIso(today, offset), env.APP_TIMEZONE).getTime() + (hh * 60 + mm) * 60_000),
    uuid: seededUuidFactory(faker),
    demoPasswordHash: await hashPassword(DEMO_PASSWORD),
    env,
    users: {
      byPersona,
      byEmail,
      get(keyOrEmail) {
        const user = byPersona.get(keyOrEmail) ?? byEmail.get(keyOrEmail.toLowerCase());
        if (!user) throw new Error(`Seed user "${keyOrEmail}" not found`);
        return user;
      },
    },
    storeFile: async (input: SeedFileInput) => {
      const createdAt = input.createdAt;
      const key = `${createdAt.getUTCFullYear()}/${String(createdAt.getUTCMonth() + 1).padStart(2, '0')}/${ctx.uuid(createdAt)}`;
      const path = join(storageRoot, ...key.split('/'));
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, input.content);
      const row = await prisma.attachment.create({
        data: {
          id: ctx.uuid(createdAt),
          storageKey: key,
          originalName: input.originalName,
          mimeType: input.mimeType,
          sizeBytes: input.content.length,
          sha256: createHash('sha256').update(input.content).digest('hex'),
          purpose: input.purpose,
          uploadedById: input.uploadedById,
          entityType: input.entity?.type ?? null,
          entityId: input.entity?.id ?? null,
          linkedAt: input.entity ? createdAt : null,
          createdAt,
        },
      });
      return { id: row.id, storageKey: key };
    },
    log,
  };

  const seeders = (await discoverSeeders()).filter((s) => !options.modules || options.modules.includes(s.module));
  for (const { module, file, seeder } of seeders) {
    const started = Date.now();
    await seeder.run(ctx);
    log(`${module}/${file} (${seeder.name}) done in ${Date.now() - started} ms`);
  }

  const value = { at: new Date().toISOString(), today, seeders: seeders.map((s) => `${s.module}/${s.seeder.name}`) };
  await prisma.systemSetting.upsert({
    where: { key: SEED_MARKER_KEY },
    create: { key: SEED_MARKER_KEY, value },
    update: { value },
  });
  log(`completed: ${seeders.length} seeders, today = ${today}`);
}

export async function isSeeded(prisma: PrismaClient): Promise<boolean> {
  return (await prisma.systemSetting.count({ where: { key: SEED_MARKER_KEY } })) > 0;
}
