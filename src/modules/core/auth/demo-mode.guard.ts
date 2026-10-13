import { CanActivate, Injectable } from '@nestjs/common';
import { ProblemException } from '@/common/http/problem';
import { AppConfig } from '@/config/app-config';

/**
 * Hides DEMO_MODE-only routes (`/auth/personas`, `/auth/demo-login`) with a 404 when DEMO_MODE
 * is off. A guard runs before body validation, so the route looks absent for every request
 * instead of answering 422 to a malformed body.
 */
@Injectable()
export class DemoModeGuard implements CanActivate {
  constructor(private readonly config: AppConfig) {}

  canActivate(): boolean {
    if (!this.config.get('DEMO_MODE')) throw ProblemException.notFound();
    return true;
  }
}
