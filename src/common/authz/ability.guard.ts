import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ProblemException } from '@/common/http/problem';
import { AbilityFactory } from './ability.factory';
import { type AbilityCheck, CHECK_ABILITY_KEY, runAbilityCheck } from './check-ability.decorator';

/**
 * Global guard (runs after JwtAuthGuard): builds `request.ability` for the current user and
 * enforces `@CheckAbility()` metadata.
 */
@Injectable()
export class AbilityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly abilities: AbilityFactory,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<Request>();
    request.ability ??= await this.abilities.createForUser(request.user);

    const checks =
      this.reflector.getAllAndMerge<AbilityCheck[]>(CHECK_ABILITY_KEY, [context.getHandler(), context.getClass()]) ??
      [];
    if (checks.length === 0) return true;
    if (!request.user) throw ProblemException.unauthenticated();

    const ability = request.ability;
    if (!checks.every((check) => runAbilityCheck(ability, check))) throw ProblemException.forbidden();
    return true;
  }
}
