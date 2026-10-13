import { toRef, toUserRef, toUserRefOrNull } from '@/common/domain/mappers';
import { isoFromDateOrNull } from '@/common/time/time';
import type { Prisma } from '@/generated/prisma/client';
import { assetTag, OPEN_ASSIGNMENT_WHERE } from '../assets.domain';
import type { AssetMachineContext } from '../machines/asset.machine';
import type { AssetAssignmentView, AssetListItemView } from '../dto/asset.dto';

export const assignmentInclude = { user: true, assignedBy: true } as const satisfies Prisma.AssetAssignmentInclude;

/** Everything a list item, a detail DTO and the workflow need (open assignment included). */
export const assetInclude = {
  model: { include: { manufacturer: true, deviceType: true } },
  platform: true,
  assignedUser: true,
  costCenter: true,
  createdBy: true,
  assignments: {
    where: OPEN_ASSIGNMENT_WHERE,
    include: assignmentInclude,
    orderBy: { assignedAt: 'desc' },
    take: 1,
  },
} as const satisfies Prisma.AssetInclude;

export type AssetRow = Prisma.AssetGetPayload<{ include: typeof assetInclude }>;
export type AssignmentRow = Prisma.AssetAssignmentGetPayload<{ include: typeof assignmentInclude }>;

export function openAssignmentOf(row: AssetRow): AssignmentRow | null {
  return row.assignments[0] ?? null;
}

/** Machine context of a row (SPEC §5.3). */
export function assetMachineContext(row: AssetRow): AssetMachineContext {
  const open = openAssignmentOf(row);
  return {
    assignedUserId: row.assignedUserId,
    hasAcceptedAssignment: open?.acceptedAt != null,
    deleted: row.deletedAt !== null,
  };
}

export function assetLabel(row: { number: number; model: { name: string } }): string {
  return `${assetTag(row.number)} · ${row.model.name}`;
}

export function toAssignmentView(row: AssignmentRow): AssetAssignmentView {
  return {
    id: row.id,
    user: toUserRef(row.user),
    assignedBy: toUserRef(row.assignedBy),
    assignedAt: row.assignedAt.toISOString(),
    note: row.note,
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    declinedAt: row.declinedAt?.toISOString() ?? null,
    declineReason: row.declineReason,
    unassignedAt: row.unassignedAt?.toISOString() ?? null,
    returnedAt: row.returnedAt?.toISOString() ?? null,
    returnCondition: row.returnCondition,
    returnNote: row.returnNote,
    reminderCount: row.reminderCount,
  };
}

export function toListItemView(row: AssetRow, availableActions: AssetListItemView['availableActions']) {
  const { deviceType, manufacturer } = row.model;
  return {
    id: row.id,
    assetTag: assetTag(row.number),
    serialNumber: row.serialNumber,
    name: row.name,
    deviceType: {
      id: deviceType.id,
      code: deviceType.code,
      name: deviceType.name,
      requiresPlatform: deviceType.requiresPlatform,
    },
    manufacturer: { id: manufacturer.id, name: manufacturer.name },
    model: { id: row.model.id, name: row.model.name },
    platform: row.platform ? { id: row.platform.id, name: row.platform.name } : null,
    status: row.status,
    assignedUser: toUserRefOrNull(row.assignedUser),
    costCenter: toRef(row.costCenter),
    purchaseDate: isoFromDateOrNull(row.purchaseDate),
    mdmEnrolled: row.mdmEnrolled,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    availableActions,
  } satisfies AssetListItemView;
}
