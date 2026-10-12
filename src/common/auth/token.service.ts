import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppConfig } from '@/config/app-config';
import { type AccessTokenClaims, type AuthUser, claimsToUser } from './auth-user';

export interface IssuedToken {
  accessToken: string;
  tokenType: 'Bearer';
  /** Lifetime in seconds. */
  expiresIn: number;
}

const TTL_UNITS = { '': 1, s: 1, m: 60, h: 3600, d: 86400 } as const;

/** Converts "8h" / "15m" / "3600" to seconds. */
export function ttlToSeconds(ttl: string): number {
  const match = /^(\d+)([smhd]?)$/.exec(ttl);
  if (!match) throw new Error(`Invalid TTL "${ttl}"`);
  return Number(match[1]) * TTL_UNITS[(match[2] ?? '') as keyof typeof TTL_UNITS];
}

/** Issues and verifies Atrium access tokens (HS256 JWT). Login itself lives in the core module. */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
  ) {}

  async issue(user: AuthUser): Promise<IssuedToken> {
    const expiresIn = ttlToSeconds(this.config.get('JWT_TTL'));
    const claims: AccessTokenClaims = { sub: user.id, email: user.email, roles: user.roles };
    const accessToken = await this.jwt.signAsync(claims, { expiresIn });
    return { accessToken, tokenType: 'Bearer', expiresIn };
  }

  /** Returns the user for a valid token; throws for invalid or expired tokens. */
  async verify(token: string): Promise<AuthUser> {
    const claims = await this.jwt.verifyAsync<AccessTokenClaims>(token);
    return claimsToUser(claims);
  }
}
