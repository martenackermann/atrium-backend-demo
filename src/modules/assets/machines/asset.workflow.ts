import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import { ProblemException } from '@/common/http/problem';
import { Clock } from '@/common/time/clock.service';
import { AppConfig } from '@/config/app-config';
import type { PrismaTx } from '@/database/prisma.types';
import type { Prisma } from '@/generated/prisma/client';
import { NotificationService } from '@/modules/core/notifications/notification.service';
import { lockRow } from '@/modules/core/workflow/workflow.actions';
import { defineWorkflow, type TransitionChange } from '@/modules/core/workflow/workflow.types';
import { isAssetAdmin } from '../abilities/assets.abilities';
import { acceptanceDueDate, assetTag, costCenterLabel, deviceNoun, type AssetStatusValue } from '../assets.domain';
import {
  type AcceptInput,
  acceptBody,
  assignBody,
  type AssignInput,
  completeRepairBody,
  declineBody,
  type DeclineInput,
  returnBody,
  type ReturnInput,
  scrapBody,
  sendToRepairBody,
  unassignBody,
} from '../dto/asset.dto';
import { assignmentAcceptedNotification } from '../mail/assignment-accepted.notification';
import { assignmentDeclinedNotification } from '../mail/assignment-declined.notification';
import { assignmentPendingNotification } from '../mail/assignment-pending.notification';
import { returnedNotification } from '../mail/returned.notification';
import {
  assetInclude,
  assetLabel,
  assetMachineContext,
  type AssetRow,
  openAssignmentOf,
} from '../services/asset.mapper';
import { assetMachine } from './asset.machine';

const assigneeOnly = ({ entity, actor }: { entity: AssetRow; actor: AuthUser }) =>
  entity.assignedUserId !== null && entity.assignedUserId === actor.id ? ('self' as const) : false;

/**
 * Binds the asset machine (SPEC §5.3) to the `assets` table: loading with visibility (D5),
 * persistence of every transition (assignment rows, cost-centre switch) and notifications (§7).
 */
@Injectable()
export class AssetWorkflow {
  readonly definition;

  constructor(
    private readonly notifications: NotificationService,
    private readonly config: AppConfig,
    private readonly clock: Clock,
  ) {
    this.definition = defineWorkflow({
      name: 'asset',
      module: 'assets',
      entityType: 'asset',
      subjectType: 'Asset',
      machine: assetMachine,
      actions: {
        assign: { input: assignBody },
        accept: { ability: false, authorize: assigneeOnly, input: acceptBody },
        decline: { ability: false, authorize: assigneeOnly, input: declineBody },
        unassign: { input: unassignBody },
        return: { input: returnBody },
        send_to_repair: { input: sendToRepairBody },
        complete_repair: { input: completeRepairBody },
        scrap: { input: scrapBody },
      },
      entityId: (row: AssetRow) => row.id,
      entityLabel: (row: AssetRow) => assetLabel(row),
      toState: (row: AssetRow) => ({ value: row.status, context: assetMachineContext(row) }),
      load: (tx, id, actor) => this.load(tx, id, actor),
      persist: (tx, row, next, change) => this.persist(tx, row, next.value as AssetStatusValue, change),
      afterTransition: ({ tx, before, entity, change }) => this.notify(tx, before, entity, change),
    });
  }

  /** Locks and loads an asset the actor may see: admins see every row, users their own (404 otherwise). */
  async load(tx: PrismaTx, id: string, actor: AuthUser): Promise<AssetRow | null> {
    if (!(await lockRow(tx, 'assets', id))) return null;
    const row = await tx.asset.findUnique({ where: { id }, include: assetInclude });
    if (!row) return null;
    if (isAssetAdmin(actor)) return row;
    return row.assignedUserId === actor.id && row.deletedAt === null ? row : null;
  }

  async defaultCostCenterId(tx: PrismaTx): Promise<string> {
    const code = this.config.get('DEFAULT_COST_CENTER_CODE');
    const cc = await tx.costCenter.findUnique({ where: { code } });
    if (!cc) throw new Error(`Default cost centre ${code} does not exist`);
    return cc.id;
  }

  private async persist(
    tx: PrismaTx,
    row: AssetRow,
    status: AssetStatusValue,
    change: TransitionChange,
  ): Promise<AssetRow | null> {
    const now = this.clock.now();
    const open = openAssignmentOf(row);
    const data: Prisma.AssetUncheckedUpdateManyInput = {
      status,
      version: { increment: 1 },
      updatedById: change.actor.id,
    };
    const release = async (assignment: Prisma.AssetAssignmentUpdateInput) => {
      if (open) await tx.assetAssignment.update({ where: { id: open.id }, data: assignment });
      data.assignedUserId = null;
      data.costCenterId = await this.defaultCostCenterId(tx);
    };

    switch (change.action) {
      case 'assign': {
        const input = change.input as AssignInput;
        const user = await tx.user.findUnique({ where: { id: input.userId } });
        if (!user?.active) throw ProblemException.fieldError('userId', 'Choose an active user.');
        await tx.assetAssignment.create({
          data: {
            assetId: row.id,
            userId: user.id,
            assignedById: change.actor.id,
            assignedAt: now,
            note: input.note,
          },
        });
        data.assignedUserId = user.id;
        break;
      }
      case 'accept': {
        const input = change.input as AcceptInput;
        const deviceType = row.model.deviceType;
        if (deviceType.requiresPlatform && !input.platformId) {
          throw ProblemException.fieldError('platformId', 'Choose the platform installed on the device.');
        }
        if (input.platformId) {
          const platform = await tx.platform.findFirst({
            where: { id: input.platformId, archivedAt: null, deviceTypes: { some: { deviceTypeId: deviceType.id } } },
          });
          if (!platform)
            throw ProblemException.fieldError('platformId', 'This platform is not available for this device.');
          data.platformId = platform.id;
        }
        const user = await tx.user.findUniqueOrThrow({ where: { id: change.actor.id } });
        if (open) await tx.assetAssignment.update({ where: { id: open.id }, data: { acceptedAt: now } });
        data.costCenterId = user.costCenterId;
        break;
      }
      case 'decline': {
        const input = change.input as DeclineInput;
        await release({ declinedAt: now, declineReason: input.reason });
        break;
      }
      case 'unassign':
        await release({ unassignedAt: now });
        break;
      case 'return': {
        const input = change.input as ReturnInput;
        await release({ returnedAt: now, returnCondition: input.condition, returnNote: input.note });
        break;
      }
      case 'scrap':
        await release({ returnedAt: now });
        break;
      default:
        // send_to_repair keeps the assignment (the device goes back to the same user);
        // complete_repair's target already reflects whether an accepted assignment is open.
        break;
    }

    const updated = await tx.asset.updateMany({ where: { id: row.id, version: row.version }, data });
    if (updated.count === 0) return null;
    return tx.asset.findUniqueOrThrow({ where: { id: row.id }, include: assetInclude });
  }

  private async notify(tx: PrismaTx, before: AssetRow, entity: AssetRow, change: TransitionChange): Promise<void> {
    const tag = assetTag(entity.number);
    const model = entity.model.name;
    const entityRef = { type: 'asset', id: entity.id };
    switch (change.action) {
      case 'assign': {
        const open = openAssignmentOf(entity);
        if (!open) return;
        await this.notifications.send(
          assignmentPendingNotification,
          {
            to: [{ userId: open.userId }],
            context: {
              userName: open.user.displayName,
              deviceType: deviceNoun(entity.model.deviceType.name),
              model,
              assetTag: tag,
              serialNumber: entity.serialNumber,
              assignedBy: change.actor.displayName,
              note: open.note,
              dueDate: acceptanceDueDate(
                open.assignedAt,
                this.config.get('ASSET_ACCEPTANCE_DUE_DAYS'),
                this.clock.timeZone,
              ),
              assetId: entity.id,
            },
            entity: entityRef,
          },
          { tx },
        );
        return;
      }
      case 'accept':
        await this.notifications.send(
          assignmentAcceptedNotification,
          {
            to: [{ mailbox: 'it_support' }],
            context: {
              userName: change.actor.displayName,
              assetTag: tag,
              model,
              platform: entity.platform?.name ?? null,
              costCenter: costCenterLabel(entity.costCenter),
              assetId: entity.id,
            },
            entity: entityRef,
          },
          { tx },
        );
        return;
      case 'decline':
        await this.notifications.send(
          assignmentDeclinedNotification,
          {
            to: [{ mailbox: 'it_support' }],
            context: {
              userName: change.actor.displayName,
              assetTag: tag,
              model,
              reason: (change.input as DeclineInput).reason,
              assetId: entity.id,
            },
            entity: entityRef,
          },
          { tx },
        );
        return;
      case 'return': {
        if (!before.assignedUser) return;
        const input = change.input as ReturnInput;
        await this.notifications.send(
          returnedNotification,
          {
            to: [{ userId: before.assignedUser.id }],
            context: {
              userName: before.assignedUser.displayName,
              assetTag: tag,
              model,
              condition: input.condition,
              note: input.note,
            },
            entity: entityRef,
          },
          { tx },
        );
        return;
      }
      default:
        return;
    }
  }
}
