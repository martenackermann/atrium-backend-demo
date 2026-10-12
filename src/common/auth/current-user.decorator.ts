import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { ProblemException } from '@/common/http/problem';
import type { AuthUser } from './auth-user';

/**
 * Injects the authenticated user. On `@Public()` routes use `@CurrentUser({ optional: true })`
 * to receive `undefined` for anonymous requests instead of a 401.
 */
export const CurrentUser = createParamDecorator(
  (options: { optional?: boolean } | undefined, ctx: ExecutionContext): AuthUser | undefined => {
    const user = ctx.switchToHttp().getRequest<Request>().user;
    if (!user && !options?.optional) throw ProblemException.unauthorized();
    return user;
  },
);
