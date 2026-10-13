import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthUser } from '@/common/auth/auth-user';
import { IS_PUBLIC_KEY } from '@/common/auth/public.decorator';
import { ProblemException } from '@/common/http/problem';
import { Clock } from '@/common/time/clock.service';
import { PrismaService } from '@/database/prisma.service';
import { PrincipalService } from '../users/principal.service';
import { TokenService } from './token.service';

export function extractBearerToken(request: Request): string | undefined {
  const header = request.headers.authorization;
  if (!header) return undefined;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}

/**
 * Global guard: every route requires `Authorization: Bearer <jwt>` unless marked `@Public()`.
 * The token must be valid, its session (`jti`) not revoked or expired, and the user active.
 * Sets `request.user` (also on public routes when a valid token is sent).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly principals: PrincipalService,
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<Request>();
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const token = extractBearerToken(request);
    const user = token ? await this.authenticate(token) : null;
    if (user) {
      request.user = user;
      return true;
    }
    if (isPublic) return true;
    throw token
      ? ProblemException.unauthenticated('The access token is invalid, expired or revoked.')
      : ProblemException.unauthenticated();
  }

  private async authenticate(token: string): Promise<AuthUser | null> {
    let claims: { sub: string; jti: string };
    try {
      claims = await this.tokens.verify(token);
    } catch {
      return null;
    }
    if (!claims.jti || !claims.sub) return null;
    const session = await this.prisma.authSession.findUnique({ where: { id: claims.jti } });
    if (!session || session.userId !== claims.sub || session.revokedAt || session.expiresAt <= this.clock.now()) {
      return null;
    }
    return this.principals.load(claims.sub, session.id);
  }
}
