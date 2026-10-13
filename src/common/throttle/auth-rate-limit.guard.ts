import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

/** Named "default" so the standard Retry-After / X-RateLimit-* headers are sent (no suffix). */
export const AUTH_THROTTLER = 'default';
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const DEMO_LOGIN_PATH = '/api/v1/auth/demo-login';
/** Routes that are rate limited (POST only). */
export const RATE_LIMITED_PATHS = ['/api/v1/auth/login', DEMO_LOGIN_PATH];
/**
 * One-click persona login (DEMO_MODE only) involves no secret, so there is nothing to brute-force:
 * it gets this multiple of LOGIN_RATE_LIMIT, which keeps long demo sessions and end-to-end runs
 * against the real API from hitting 429. Password login keeps the SPEC limit.
 */
export const DEMO_LOGIN_LIMIT_FACTOR = 10;

/** Per-request limit: LOGIN_RATE_LIMIT, or the relaxed limit for the demo login route. */
export function loginLimitFor(context: ExecutionContext, loginRateLimit: number): number {
  const request = context.switchToHttp().getRequest<Request>();
  return request.path === DEMO_LOGIN_PATH ? loginRateLimit * DEMO_LOGIN_LIMIT_FACTOR : loginRateLimit;
}

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
