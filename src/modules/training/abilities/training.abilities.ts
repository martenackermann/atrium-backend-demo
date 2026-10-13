import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import { hasRole } from '@/common/auth/auth-user';
import { AbilityRules } from '@/common/authz/ability.factory';
import type { AbilityRulesContributor, AppAbilityBuilder } from '@/common/authz/ability.types';
import { BACK_OFFICE_ACTIONS } from '../training.constants';

/**
 * CASL role rules of the training module (SPEC §3.1). Relationship rules (attendee, requester,
 * approver, deputy, manager chain) are checked by the workflow `authorize` hooks and the
 * visibility filters in TrainingViewer; it_admin never gets approval rights (D13).
 */
@Injectable()
@AbilityRules()
export class TrainingAbilities implements AbilityRulesContributor {
  define(user: AuthUser, { can }: AppAbilityBuilder): void {
    if (hasRole(user, 'training_office', 'it_admin')) {
      can([...BACK_OFFICE_ACTIONS], 'TrainingAttendee');
      can('manage', 'TrainingOffice');
    }
  }
}
