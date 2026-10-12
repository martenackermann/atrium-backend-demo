import type { AppAbility } from '../authz/ability.types';
import type { AuthUser } from './auth-user';

declare global {
  namespace Express {
    interface Request {
      /** Set by JwtAuthGuard for authenticated requests. */
      user?: AuthUser;
      /** Lazily built and cached by AbilityService.forRequest(). */
      ability?: AppAbility;
    }
  }
}

export {};
