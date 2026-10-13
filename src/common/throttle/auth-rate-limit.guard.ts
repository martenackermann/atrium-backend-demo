import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

/** Named "default" so the standard Retry-After / X-RateLimit-* headers are sent (no suffix). */
export const AUTH_THROTTLER = 'default';
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
/** Routes that are rate limited (POST only). */
export const RATE_LIMITED_PATHS = ['/api/v1/auth/login', '/api/v1/auth/demo-login'];

/**
 * Login rate limit (SPEC §9 LOGIN_RATE_LIMIT): N attempts per 15 minutes per email (or
 * persona) + client IP on the login routes. Everything else is skipped.
 */
@Injectable()
export class AuthRateLimitGuard extends ThrottlerGuard {
  protected override shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return Promise.resolve(true);
    const request = context.switchToHttp().getRequest<Request>();
    return Promise.resolve(!(request.method === 'POST' && RATE_LIMITED_PATHS.includes(request.path)));
  }

  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const body = (req.body ?? {}) as { email?: unknown; personaKey?: unknown };
    const who =
      typeof body.email === 'string'
        ? body.email.trim().toLowerCase()
        : typeof body.personaKey === 'string'
          ? body.personaKey
          : '';
    return Promise.resolve(`${String(req.ip)}|${who}`);
  }
}
