import { AbilityBuilder } from '@casl/ability';
import { createPrismaAbility } from '@casl/prisma';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import type { AuthUser } from '@/common/auth/auth-user';
import type { AbilityRulesContributor, AppAbility } from './ability.types';

/**
 * Marks a provider as a source of CASL rules. The provider must implement
 * `AbilityRulesContributor` and be listed in its module's `providers`.
 *
 * @example
 * @Injectable() @AbilityRules()
 * export class TrainingAbilities implements AbilityRulesContributor { define(user, { can }) { ... } }
 */
export const AbilityRules = DiscoveryService.createDecorator<void>();

/** Builds the CASL ability of a user. Bound to `ContributorAbilityFactory` by AuthzModule. */
export abstract class AbilityFactory {
  abstract createForUser(user: AuthUser | undefined): Promise<AppAbility>;
}

export function createAppAbility(rules: AppAbility['rules'] = []): AppAbility {
  return createPrismaAbility<AppAbility>(rules);
}

/** Collects the rules of every `@AbilityRules()` provider, in module registration order. */
@Injectable()
export class ContributorAbilityFactory extends AbilityFactory implements OnModuleInit {
  private contributors: AbilityRulesContributor[] = [];

  constructor(private readonly discovery: DiscoveryService) {
    super();
  }

  onModuleInit(): void {
    this.contributors = this.discovery
      .getProviders({ metadataKey: AbilityRules.KEY })
      .map((wrapper) => wrapper.instance as AbilityRulesContributor)
      .filter((instance) => typeof instance?.define === 'function');
  }

  async createForUser(user: AuthUser | undefined): Promise<AppAbility> {
    const builder = new AbilityBuilder<AppAbility>(createPrismaAbility);
    if (user) {
      for (const contributor of this.contributors) {
        await contributor.define(user, builder);
      }
    }
    return builder.build();
  }
}
