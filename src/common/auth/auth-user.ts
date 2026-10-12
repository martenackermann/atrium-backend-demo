/** The authenticated principal attached to `request.user` by JwtAuthGuard. */
export interface AuthUser {
  id: string;
  email: string;
  /** Role keys, e.g. ["employee", "manager"]. Defined by the core module (2b). */
  roles: string[];
}

/** Claims carried in Atrium access tokens. */
export interface AccessTokenClaims {
  sub: string;
  email: string;
  roles: string[];
}

export function claimsToUser(claims: AccessTokenClaims): AuthUser {
  return { id: claims.sub, email: claims.email, roles: Array.isArray(claims.roles) ? claims.roles : [] };
}
