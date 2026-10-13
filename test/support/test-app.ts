import 'reflect-metadata';
import type { ModuleMetadata } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '@/app.module';
import { configureApp } from '@/bootstrap/configure-app';
import type { PersonaKey } from '@/common/domain/vocabulary';
import { AppConfig } from '@/config/app-config';
import { PrismaService } from '@/database/prisma.service';
import { runSeed } from '@/database/seed/run-seed';

export interface TestApp {
  app: NestExpressApplication;
  prisma: PrismaService;
  /** Supertest client bound to the app's HTTP server. */
  http: () => ReturnType<typeof request>;
  /** `Authorization` header value after a real demo login (session row included). */
  login: (persona: PersonaKey) => Promise<string>;
  /** Id of a seeded user by persona key, handle (`priya`, `hilTech1`) or email. */
  userId: (keyOrEmail: string) => Promise<string>;
  close: () => Promise<void>;
}

export interface TestAppOptions {
  /** Test-only modules (fixtures). */
  imports?: ModuleMetadata['imports'];
  /** Seed these modules after boot (default: ['core']); [] = no seed. */
  seed?: string[];
}

const PERSONA_EMAIL: Record<PersonaKey, string> = {
  emma: 'emma.employee@example.com',
  max: 'max.manager@example.com',
  sofia: 'sofia.site-manager@example.com',
  clara: 'clara.ceo@example.com',
  tom: 'tom.travel-desk@example.com',
  tina: 'tina.training-office@example.com',
  arne: 'arne.assets@example.com',
  paula: 'paula.people-ops@example.com',
  ian: 'ian.it-admin@example.com',
};

/**
 * Boots the full AppModule (plus optional test-only modules) exactly like main.ts does,
 * against the test database, and seeds the core org (52 users, personas, deputies).
 * Tables are truncated before each test file (setup-e2e.ts). Call `close()` in afterAll.
 */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule, ...(options.imports ?? [])] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.init();

  const prisma = app.get(PrismaService);
  const modules = options.seed ?? ['core'];
  if (modules.length) await runSeed(prisma, { env: app.get(AppConfig).snapshot(), modules, log: () => undefined });

  const http = () => request(app.getHttpServer());
  return {
    app,
    prisma,
    http,
    login: async (persona) => {
      const res = await http().post('/api/v1/auth/login').send({ email: PERSONA_EMAIL[persona], password: 'demo1234' });
      if (res.status !== 200) throw new Error(`Login as ${persona} failed: ${res.status} ${JSON.stringify(res.body)}`);
      return `Bearer ${(res.body as { accessToken: string }).accessToken}`;
    },
    userId: async (keyOrEmail) => {
      const email = keyOrEmail.includes('@') ? keyOrEmail : PERSONA_EMAIL[keyOrEmail as PersonaKey];
      const user = email
        ? await prisma.user.findUnique({ where: { email } })
        : await prisma.user.findFirst({ where: { firstName: keyOrEmail } });
      if (!user) throw new Error(`User ${keyOrEmail} not found`);
      return user.id;
    },
    close: () => app.close(),
  };
}

export { PERSONA_EMAIL };
