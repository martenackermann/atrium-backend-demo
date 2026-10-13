import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import { hasRole } from '@/common/auth/auth-user';
import { AbilityRules } from '@/common/authz/ability.factory';
import type { AbilityRulesContributor, AppAbilityBuilder } from '@/common/authz/ability.types';

/** Admin-only asset actions (SPEC §3.3). `accept`/`decline` are decided by the workflow (assigned user only). */
export const ASSET_ADMIN_ACTIONS = [
  'create',
  'read',
  'update',
  'delete',
  'assign',
  'unassign',
  'return',
  'send_to_repair',
  'complete_repair',
  'scrap',
  'export',
  'timeline',
] as const;

export function isAssetAdmin(user: Pick<AuthUser, 'roles'>): boolean {
  return hasRole(user, 'asset_admin', 'it_admin');
}

/**
 * CASL rules of the assets module (SPEC §3.3). Subjects: `Asset` (rows), `AssetCatalog`
 * (device types, manufacturers, platforms, models) and `AssetDashboard`.
 */
@Injectable()
@AbilityRules()
export class AssetsAbilities implements AbilityRulesContributor {
  define(user: AuthUser, { can }: AppAbilityBuilder): void {
    // Everyone reads their own devices and the active catalogue (platform choice on accept).
    can('read', 'Asset', { assignedUserId: user.id, deletedAt: null });
    can('read', 'AssetCatalog');

    if (isAssetAdmin(user)) {
      can([...ASSET_ADMIN_ACTIONS], 'Asset');
      can('manage', 'AssetCatalog');
      can('read', 'AssetDashboard');
    }
  }
}
