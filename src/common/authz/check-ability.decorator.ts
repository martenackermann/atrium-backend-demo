import { applyDecorators, createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { ApiProblemResponses } from '@/common/http/api-problem-response.decorator';
import { ProblemException } from '@/common/http/problem';
import type { AppAbility, AppAction, AppSubject, AppSubjectType } from './ability.types';

export type AbilityCheck = { action: AppAction; subject: AppSubjectType } | ((ability: AppAbility) => boolean);

export const CHECK_ABILITY_KEY = 'atrium:checkAbility';

/**
 * Route-level (type-level) permission check, enforced by AbilityGuard after authentication.
 * Instance-level checks (a specific row) belong in the service: use `assertCan()`.
 *
 * @example @CheckAbility('read', 'TrainingRequest')
 * @example @CheckAbility((ability) => ability.can('approve', 'TrainingRequest'))
 */
export function CheckAbility(action: AppAction, subject: AppSubjectType): MethodDecorator & ClassDecorator;
export function CheckAbility(check: (ability: AppAbility) => boolean): MethodDecorator & ClassDecorator;
export function CheckAbility(
  actionOrCheck: AppAction | ((ability: AppAbility) => boolean),
  subject?: AppSubjectType,
): MethodDecorator & ClassDecorator {
  const check: AbilityCheck =
    typeof actionOrCheck === 'function' ? actionOrCheck : { action: actionOrCheck, subject: subject ?? 'all' };
  return applyDecorators(SetMetadata(CHECK_ABILITY_KEY, [check]), ApiProblemResponses(403));
}

export function runAbilityCheck(ability: AppAbility, check: AbilityCheck): boolean {
  return typeof check === 'function' ? check(ability) : ability.can(check.action, check.subject);
}

/** Injects the current request's CASL ability (built by AbilityGuard for every request). */
export const CurrentAbility = createParamDecorator((_: unknown, ctx: ExecutionContext): AppAbility => {
  const ability = ctx.switchToHttp().getRequest<Request>().ability;
  if (!ability) throw new Error('CurrentAbility used before AbilityGuard ran');
  return ability;
});

/** Throws a 403 problem unless `ability` allows `action` on `subject`. */
export function assertCan(ability: AppAbility, action: AppAction, subject: AppSubject, detail?: string): void {
  if (ability.cannot(action, subject)) throw ProblemException.forbidden(detail);
}
