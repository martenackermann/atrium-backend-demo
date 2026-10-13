import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { requestIdMiddleware } from '@/common/http/request-context';
import { AppConfig } from '@/config/app-config';
import { setupSwagger } from './openapi';

export const API_PREFIX = 'api/v1';

/**
 * HTTP-level setup shared by main.ts and the e2e test app. Pipes, filters, guards and
 * interceptors are registered as APP_* providers in AppModule instead.
 */
export function configureApp(app: NestExpressApplication, options: { swagger?: boolean } = {}): void {
  const config = app.get(AppConfig);

  app.use(requestIdMiddleware);
  app.setGlobalPrefix(API_PREFIX);
  // Client IPs (login rate limit) come from X-Forwarded-For only when a trusted proxy sets it.
  app.set('trust proxy', config.get('TRUST_PROXY'));
  app.use(helmet());
  // Bearer tokens only (no cookies), explicit origins only.
  app.enableCors({
    origin: config.get('CORS_ORIGINS'),
    credentials: false,
    exposedHeaders: ['X-Request-Id', 'Content-Disposition', 'Retry-After', 'Location', 'Idempotent-Replayed'],
  });

  if (options.swagger !== false) setupSwagger(app);
}
