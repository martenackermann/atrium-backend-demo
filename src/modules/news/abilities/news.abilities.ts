import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import { hasRole } from '@/common/auth/auth-user';
import { AbilityRules } from '@/common/authz/ability.factory';
import type { AbilityRulesContributor, AppAbilityBuilder } from '@/common/authz/ability.types';

export function isNewsEditor(user: Pick<AuthUser, 'roles'>): boolean {
  return hasRole(user, 'news_editor', 'it_admin');
}

/** SPEC §3.5: everyone reads published news and active links; editors (and it_admin) manage them. */
@Injectable()
@AbilityRules()
export class NewsAbilities implements AbilityRulesContributor {
  define(user: AuthUser, { can }: AppAbilityBuilder): void {
    can('read', 'NewsPost', { status: 'published', deletedAt: null });
    can('read', 'UsefulLink', { active: true });
    if (isNewsEditor(user)) {
      can(
        [
          'read',
          'create',
          'edit',
          'delete',
          'publish',
          'schedule',
          'unschedule',
          'archive',
          'restore',
          'read_timeline',
        ],
        'NewsPost',
      );
      can(['read', 'create', 'update', 'delete', 'reorder'], 'UsefulLink');
    }
  }
}
