import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import { AbilityRules } from '@/common/authz/ability.factory';
import type { AbilityRulesContributor, AppAbilityBuilder } from '@/common/authz/ability.types';
import { isPeopleBackOffice } from '../people.constants';

/**
 * SPEC §3.4 role rules. Relationship rules (requester, manager, manager's deputy) are
 * relationship predicates in `people-access.ts` and the workflow's `authorize` hooks.
 */
@Injectable()
@AbilityRules()
export class PeopleAbilities implements AbilityRulesContributor {
  define(user: AuthUser, { can }: AppAbilityBuilder): void {
    can('create', 'PeopleRequest');
    can('read', 'JobRole');
    if (isPeopleBackOffice(user)) {
      can(
        ['start_work', 'wait_internal', 'wait_on_requester', 'resume', 'complete', 'reject', 'read_all'],
        'PeopleRequest',
      );
      can(['edit_internal', 'comment_internal'], 'PeopleRequest');
      can(['create', 'update', 'read_inactive'], 'JobRole');
    }
  }
}
