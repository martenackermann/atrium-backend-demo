import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ProblemException } from '@/common/http/problem';
import { IS_PUBLIC_KEY } from './public.decorator';
import { TokenService } from './token.service';

export function extractBearerToken(request: Request): string | undefined {
  const header = request.headers.authorization;
  if (!header) return undefined;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}

/**
 * Global guard: every route requires a valid `Authorization: Bearer <jwt>` unless it is
 * marked `@Public()`. Sets `request.user`.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<Request>();
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const token = extractBearerToken(request);

    if (!token) {
      if (isPublic) return true;
      throw ProblemException.unauthorized();
    }

    try {
      request.user = await this.tokens.verify(token);
    } catch {
      if (isPublic) return true;
      throw ProblemException.unauthorized('The access token is invalid or has expired.');
    }
    return true;
  }
}
