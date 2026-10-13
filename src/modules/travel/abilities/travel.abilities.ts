import { Injectable } from '@nestjs/common';
import { type AuthUser, hasRole } from '@/common/auth/auth-user';
import { AbilityRules } from '@/common/authz/ability.factory';
import type { AbilityRulesContributor, AppAbilityBuilder } from '@/common/authz/ability.types';

/** Back-office transitions (SPEC §3.2): travel desk and it_admin. */
export const TRAVEL_DESK_ACTIONS = [
  'book',
  'mark_booking_impossible',
  'retry_booking',
  'confirm_cancellation',
  'reject_cancellation',
  'close',
] as const;

/**
 * Role rules of the travel module (SPEC §3.2). Relationship rules (traveller, requester,
 * approver, deputy, manager chain) live in TravelAccessService and the workflow's
 * `authorize` hooks; it_admin never decides approvals (D13).
 */
@Injectable()
@AbilityRules()
export class TravelAbilities implements AbilityRulesContributor {
  define(user: AuthUser, { can }: AppAbilityBuilder): void {
    can('create', 'TravelRequest');
    can('read', 'CarRentalClass');
    if (hasRole(user, 'travel_desk', 'it_admin')) {
      can([...TRAVEL_DESK_ACTIONS], 'TravelRequest');
      can(['list_all', 'export'], 'TravelRequest');
      can(['create', 'update'], 'CarRentalClass');
    }
  }
}
