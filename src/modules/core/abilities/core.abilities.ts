import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import { hasRole } from '@/common/auth/auth-user';
import { AbilityRules } from '@/common/authz/ability.factory';
import type { AbilityRulesContributor, AppAbilityBuilder } from '@/common/authz/ability.types';

/**
 * Core CASL rules (SPEC §3.5). Relationship rules (approver, deputy, manager chain) are
 * not expressed here but in ApprovalService and in the slices' Prisma where-clauses.
 */
@Injectable()
@AbilityRules()
export class CoreAbilities implements AbilityRulesContributor {
  define(user: AuthUser, { can }: AppAbilityBuilder): void {
    can('read', 'User');
    can('read', 'Notification', { userId: user.id });
    if (hasRole(user, 'manager', 'executive', 'it_admin')) can('create', 'Deputy');
    can(['update', 'delete'], 'Deputy', { principalId: user.id });

    if (hasRole(user, 'it_admin')) {
      // user/role admin, job runner, settings view
      can('manage', 'AdminConsole');
      can('read', 'AuditLog');
    }
  }
}
