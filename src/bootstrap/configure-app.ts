import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppConfig } from '@/config/app-config';
import { setupSwagger } from './openapi';

export const API_PREFIX = 'api/v1';

/**
 * HTTP-level setup shared by main.ts and the e2e test app. Pipes, filters, guards and
 * interceptors are registered as APP_* providers in AppModule instead.
 */
export function configureApp(app: NestExpressApplication, options: { swagger?: boolean } = {}): void {
  const config = app.get(AppConfig);

  app.setGlobalPrefix(API_PREFIX);
  // Behind a reverse proxy / docker network: use X-Forwarded-For for client IPs (rate limits).
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  app.use(helmet());
  app.enableCors({
    origin: config.get('CORS_ORIGINS'),
    credentials: true,
    exposedHeaders: ['X-Request-Id', 'Content-Disposition', 'Retry-After'],
  });

  if (options.swagger !== false) setupSwagger(app);
}
