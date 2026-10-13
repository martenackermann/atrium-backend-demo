import { addDaysIso, type IsoDate, isoDateInZone, startOfDayInZone } from '@/common/time/time';

/** API.md §2.2 AssetStatus, in lifecycle order (SPEC §5.3). */
export const ASSET_STATUSES = ['in_stock', 'pending_acceptance', 'in_use', 'in_repair', 'scrapped'] as const;
export type AssetStatusValue = (typeof ASSET_STATUSES)[number];

export const RETURN_CONDITIONS = ['ok', 'damaged'] as const;
export type ReturnConditionValue = (typeof RETURN_CONDITIONS)[number];

/** API.md §6.2 AssetAction: workflow actions in canonical machine order, then capability flags. */
export const ASSET_ACTIONS = [
  'assign',
  'accept',
  'decline',
  'unassign',
  'return',
  'send_to_repair',
  'complete_repair',
  'scrap',
  'edit',
  'delete',
] as const;
export type AssetAction = (typeof ASSET_ACTIONS)[number];

/** Statuses in which an asset may be soft-deleted (SPEC §4.4). */
export const DELETABLE_STATUSES: readonly AssetStatusValue[] = ['in_stock', 'scrapped'];

/** Statuses whose assigned user owns the device ("My devices" active list, cost-centre sync). */
export const ACTIVE_STATUSES: readonly AssetStatusValue[] = ['in_use', 'in_repair'];

export const ASSET_TAG_PREFIX = 'AST-';

/** `87` -> `AST-00087` (SPEC D1). */
export function assetTag(number: number): string {
  return `${ASSET_TAG_PREFIX}${String(number).padStart(5, '0')}`;
}

/** `AST-00087` / `ast-87` -> 87; anything else -> null (references are matched exactly). */
export function parseAssetTag(value: string): number | null {
  const match = /^AST-(\d{1,9})$/i.exec(value.trim());
  return match ? Number(match[1]) : null;
}

/** Open assignment = not declined, unassigned or returned (SPEC §4.4). */
export const OPEN_ASSIGNMENT_WHERE = { declinedAt: null, unassignedAt: null, returnedAt: null } as const;

/**
 * Acceptance due date (SPEC_RESOLUTIONS #23): the calendar day `ASSET_ACCEPTANCE_DUE_DAYS` after the
 * assignment day (APP_TIMEZONE). The inbox `dueAt` is 00:00 of that day as UTC (#31).
 */
export function acceptanceDueDate(assignedAt: Date, dueDays: number, timeZone: string): IsoDate {
  return addDaysIso(isoDateInZone(assignedAt, timeZone), dueDays);
}

export function acceptanceDueAt(assignedAt: Date, dueDays: number, timeZone: string): Date {
  return startOfDayInZone(acceptanceDueDate(assignedAt, dueDays, timeZone), timeZone);
}

/** Overdue from the due day on (`now >= dueAt`). */
export function isAcceptanceOverdue(assignedAt: Date, now: Date, dueDays: number, timeZone: string): boolean {
  return now.getTime() >= acceptanceDueAt(assignedAt, dueDays, timeZone).getTime();
}

/**
 * Pending assignments with `assignedAt` before this instant are overdue: 00:00 (APP_TIMEZONE) of
 * `today - dueDays + 1`, i.e. assigned on or before `today - dueDays`.
 */
export function overdueAssignedBefore(today: IsoDate, dueDays: number, timeZone: string): Date {
  return startOfDayInZone(addDaysIso(today, -dueDays + 1), timeZone);
}

/** Lower-case device-type noun for sentences ("Confirm your new laptop"). */
export function deviceNoun(deviceTypeName: string): string {
  return deviceTypeName.toLowerCase();
}

/** `CC-4900 IT Stock` (used in field diffs and CSV). */
export function costCenterLabel(cc: { code: string; name: string }): string {
  return `${cc.code} ${cc.name}`;
}
