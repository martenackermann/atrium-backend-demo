import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';

export const IS_PUBLIC_KEY = 'atrium:isPublic';
/** OpenAPI marker; the document builder turns it into `security: []`. */
export const PUBLIC_OPENAPI_EXTENSION = 'x-atrium-public';

/**
 * Opts a route (or controller) out of the global JwtAuthGuard. A valid bearer token is
 * still parsed, so `@CurrentUser({ optional: true })` works on public routes.
 */
export const Public = (): MethodDecorator & ClassDecorator =>
  applyDecorators(SetMetadata(IS_PUBLIC_KEY, true), ApiExtension(PUBLIC_OPENAPI_EXTENSION, true));
