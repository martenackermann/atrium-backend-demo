import { Global, Module } from '@nestjs/common';
import { APP_GUARD, DiscoveryModule } from '@nestjs/core';
import { AbilityFactory, ContributorAbilityFactory } from './ability.factory';
import { AbilityGuard } from './ability.guard';

/** CASL authorization: ability factory (rules from `@AbilityRules()` providers) + global guard. */
@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [
    { provide: AbilityFactory, useClass: ContributorAbilityFactory },
    { provide: APP_GUARD, useClass: AbilityGuard },
  ],
  exports: [AbilityFactory],
})
export class AuthzModule {}
