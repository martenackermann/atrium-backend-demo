import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

/** Named "default" so the standard Retry-After / X-RateLimit-* headers are sent (no suffix). */
export const AUTH_THROTTLER = 'default';
export const AUTH_PATH_PREFIX = '/api/v1/auth/';

/**
 * Global rate limit that applies only to `/api/v1/auth/*` (login, password reset...).
 * Limit: AUTH_RATE_LIMIT_PER_MINUTE requests per minute, client IP and route.
 */
@Injectable()
export class AuthRateLimitGuard extends ThrottlerGuard {
  protected override shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return Promise.resolve(true);
    const request = context.switchToHttp().getRequest<Request>();
    return Promise.resolve(!request.path.startsWith(AUTH_PATH_PREFIX));
  }
}
