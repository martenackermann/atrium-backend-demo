import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap/configure-app';
import { DOCS_PATH } from './bootstrap/openapi';
import { AppConfig } from './config/app-config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);
  configureApp(app);
  app.enableShutdownHooks();

  const config = app.get(AppConfig);
  await app.listen(config.get('PORT'));
  logger.log(
    `Atrium API listening on port ${config.get('PORT')} - docs at ${config.get('API_PUBLIC_URL')}/${DOCS_PATH}`,
  );
}

void bootstrap();
