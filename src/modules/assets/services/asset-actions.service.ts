import { subject } from '@casl/ability';
import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import type { AppAbility, AppSubjectInstance } from '@/common/authz/ability.types';
import type { PrismaTx } from '@/database/prisma.types';
import { WorkflowService } from '@/modules/core/workflow/workflow.service';
import { type AssetAction, DELETABLE_STATUSES } from '../assets.domain';
import { AssetWorkflow } from '../machines/asset.workflow';
import type { AssetRow } from './asset.mapper';

export function assetSubject(row: AssetRow): AppSubjectInstance {
  return subject('Asset', row as unknown as Record<string, unknown>);
}

/**
 * `availableActions` of an asset for the current user (D7): the workflow actions the machine and
 * the permissions allow, then the capability flags `edit` (PATCH) and `delete` (soft delete).
 */
@Injectable()
export class AssetActionsService {
  constructor(
    private readonly workflows: WorkflowService,
    private readonly workflow: AssetWorkflow,
  ) {}

  async for(row: AssetRow, user: AuthUser, ability: AppAbility, db?: PrismaTx): Promise<AssetAction[]> {
    const actions = (await this.workflows.availableActions(
      this.workflow.definition,
      row,
      user,
      ability,
      db,
    )) as AssetAction[];
    if (this.canEdit(row, ability)) actions.push('edit');
    if (this.canDelete(row, ability)) actions.push('delete');
    return actions;
  }

  canEdit(row: AssetRow, ability: AppAbility): boolean {
    return row.deletedAt === null && row.status !== 'scrapped' && ability.can('update', assetSubject(row));
  }

  canDelete(row: AssetRow, ability: AppAbility): boolean {
    return (
      row.deletedAt === null && DELETABLE_STATUSES.includes(row.status) && ability.can('delete', assetSubject(row))
    );
  }
}
