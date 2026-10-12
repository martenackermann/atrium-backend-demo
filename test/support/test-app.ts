import 'reflect-metadata';
import type { ModuleMetadata } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '@/app.module';
import { configureApp } from '@/bootstrap/configure-app';
import type { AuthUser } from '@/common/auth/auth-user';
import { TokenService } from '@/common/auth/token.service';
import { PrismaService } from '@/database/prisma.service';

export interface TestApp {
  app: NestExpressApplication;
  prisma: PrismaService;
  /** Supertest client bound to the app's HTTP server. */
  http: () => ReturnType<typeof request>;
  /** `Authorization` header value for a (not necessarily persisted) user. */
  bearer: (user: Partial<AuthUser> & { id: string }) => Promise<string>;
  close: () => Promise<void>;
}

/**
 * Boots the full AppModule (plus optional test-only modules) exactly like main.ts does,
 * against the test database. Call `close()` in afterAll.
 */
export async function createTestApp(options: { imports?: ModuleMetadata['imports'] } = {}): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule, ...(options.imports ?? [])] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.init();

  const tokens = app.get(TokenService);
  return {
    app,
    prisma: app.get(PrismaService),
    http: () => request(app.getHttpServer()),
    bearer: async (user) => {
      const { accessToken } = await tokens.issue({ email: `${user.id}@example.com`, roles: [], ...user });
      return `Bearer ${accessToken}`;
    },
    close: () => app.close(),
  };
}
