import './openapi-env';
import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { API_PREFIX } from '../bootstrap/configure-app';
import { buildOpenApiDocument } from '../bootstrap/openapi';

/** Writes openapi.json at the repo root (`pnpm openapi:export`). CI fails if it is stale. */
async function exportOpenApi(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false, preview: true, abortOnError: false });
  app.setGlobalPrefix(API_PREFIX);
  const document = buildOpenApiDocument(app);
  const target = resolve(process.cwd(), 'openapi.json');
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
  await app.close();
  console.log(`OpenAPI document written to ${target} (${Object.keys(document.paths).length} paths)`);
}

exportOpenApi().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
