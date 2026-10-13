import type { RoleName } from '@/common/domain/vocabulary';

/**
 * The authenticated principal attached to `request.user` by the core JwtAuthGuard.
 * Loaded from the database on every request, so role changes apply immediately.
 */
export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  /** Effective roles: always `employee`; `manager` when the user has active direct reports. */
  roles: RoleName[];
  isSiteManager: boolean;
  /** JWT id of the current session (null for system principals). */
  sessionId: string | null;
}

export function hasRole(user: Pick<AuthUser, 'roles'>, ...roles: RoleName[]): boolean {
  return roles.some((role) => user.roles.includes(role));
}

/** Claims carried in Atrium access tokens (roles are not in the token; they are loaded per request). */
export interface AccessTokenClaims {
  sub: string;
  jti: string;
  email: string;
}
