import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AccessTokenClaims } from '@/common/auth/auth-user';
import { Clock } from '@/common/time/clock.service';
import { AppConfig } from '@/config/app-config';

export interface IssuedToken {
  accessToken: string;
  sessionId: string;
  expiresAt: Date;
}

/** Issues and verifies HS256 access tokens. Each token's `jti` is an `auth_sessions` row. */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly clock: Clock,
  ) {}

  get ttlSeconds(): number {
    return this.config.get('JWT_TTL_MINUTES') * 60;
  }

  async issue(user: { id: string; email: string }): Promise<IssuedToken> {
    const sessionId = randomUUID();
    const claims: AccessTokenClaims = { sub: user.id, jti: sessionId, email: user.email };
    const accessToken = await this.jwt.signAsync(claims, { expiresIn: this.ttlSeconds });
    return { accessToken, sessionId, expiresAt: new Date(this.clock.now().getTime() + this.ttlSeconds * 1000) };
  }

  /** Throws for malformed, tampered or expired tokens. */
  verify(token: string): Promise<AccessTokenClaims> {
    return this.jwt.verifyAsync<AccessTokenClaims>(token);
  }
}
