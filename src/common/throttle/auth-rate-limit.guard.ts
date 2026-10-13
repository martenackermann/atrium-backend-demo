import { ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/** Named "default" so the standard Retry-After / X-RateLimit-* headers are sent (no suffix). */
export const AUTH_THROTTLER = 'default';
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
/**
 * One-click persona login (DEMO_MODE only) involves no secret, so there is nothing to brute-force:
 * it gets this multiple of LOGIN_RATE_LIMIT, which keeps long demo sessions and end-to-end runs
 * against the real API from hitting 429. Password login keeps the SPEC limit.
 */
export const DEMO_LOGIN_LIMIT_FACTOR = 10;

export const LOGIN_RATE_LIMIT_KEY = 'atrium:loginRateLimit';

interface LoginRateLimitOptions {
  /** Multiple of LOGIN_RATE_LIMIT allowed on this route (default 1). */
  factor?: number;
}

/**
 * Marks a login route as rate limited (LOGIN_RATE_LIMIT per 15 min per email/persona + client IP).
 * The limit is bound to the route handler, not to the URL: Express also routes `/auth/login/` and
 * `/AUTH/LOGIN` to the handler, and those variants must not get a fresh budget.
 */
export const LoginRateLimit = (options: LoginRateLimitOptions = {}): MethodDecorator =>
  SetMetadata(LOGIN_RATE_LIMIT_KEY, { factor: options.factor ?? 1 } satisfies LoginRateLimitOptions);

function routeLimit(context: ExecutionContext): Required<LoginRateLimitOptions> | undefined {
  if (context.getType() !== 'http') return undefined;
  return Reflect.getMetadata(LOGIN_RATE_LIMIT_KEY, context.getHandler()) as Required<LoginRateLimitOptions> | undefined;
}

/** Per-request limit: LOGIN_RATE_LIMIT times the route's factor (10 for the demo login). */
export function loginLimitFor(context: ExecutionContext, loginRateLimit: number): number {
  return loginRateLimit * (routeLimit(context)?.factor ?? 1);
}

/**
 * Login rate limit (SPEC §9 LOGIN_RATE_LIMIT): N attempts per 15 minutes per email (or
 * persona) + client IP on routes marked `@LoginRateLimit()`. Everything else is skipped.
 */
@Injectable()
export class AuthRateLimitGuard extends ThrottlerGuard {
  protected override shouldSkip(context: ExecutionContext): Promise<boolean> {
    return Promise.resolve(routeLimit(context) === undefined);
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
