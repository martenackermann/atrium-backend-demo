import type { AuthUser } from '@/common/auth/auth-user';
import { hasRole } from '@/common/auth/auth-user';

export const PEOPLE_REQUEST_TYPES = ['onboarding', 'offboarding', 'role_change'] as const;
export type PeopleRequestType = (typeof PEOPLE_REQUEST_TYPES)[number];

export const PEOPLE_REQUEST_STATUSES = [
  'open',
  'in_progress',
  'waiting_internal',
  'waiting_on_requester',
  'reopened',
  'completed',
  'rejected',
  'cancelled',
] as const;
export type PeopleRequestStatus = (typeof PEOPLE_REQUEST_STATUSES)[number];

/** SPEC §5.4: the "closed" states. */
export const CLOSED_STATUSES: readonly PeopleRequestStatus[] = ['completed', 'rejected', 'cancelled'];
export const OPEN_STATUSES: readonly PeopleRequestStatus[] = PEOPLE_REQUEST_STATUSES.filter(
  (s) => !CLOSED_STATUSES.includes(s),
);

export const PRIORITIES = ['critical', 'high', 'normal', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const SALUTATIONS = ['mr', 'ms', 'mx'] as const;
export const PEOPLE_COMMENT_KINDS = ['comment', 'question', 'status_note'] as const;
export type PeopleCommentKind = (typeof PEOPLE_COMMENT_KINDS)[number];

/** API.md §7.1 PeopleAction, canonical order (= availableActions order). */
export const PEOPLE_ACTIONS = [
  'start_work',
  'wait_internal',
  'wait_on_requester',
  'resume',
  'complete',
  'reject',
  'cancel',
  'reopen',
  'edit',
  'edit_internal',
  'comment',
  'comment_internal',
] as const;
export type PeopleAction = (typeof PEOPLE_ACTIONS)[number];

export const TYPE_LABELS: Record<PeopleRequestType, string> = {
  onboarding: 'Onboarding',
  offboarding: 'Offboarding',
  role_change: 'Role or access change',
};

export const STATUS_LABELS: Record<PeopleRequestStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting_internal: 'Waiting (internal)',
  waiting_on_requester: 'Waiting on requester',
  reopened: 'Reopened',
  completed: 'Completed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  critical: 'Critical',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

/** Human reference: PPL-000012 (SPEC D1). */
export function peopleReference(number: number): string {
  return `PPL-${String(number).padStart(6, '0')}`;
}

/** Parses an exact reference ("ppl-000012" too) into its number, else null. */
export function parsePeopleReference(q: string): number | null {
  const match = /^PPL-(\d{1,9})$/i.exec(q.trim());
  return match ? Number(match[1]) : null;
}

/** people_ops or it_admin: the people back office (SPEC §3.4). */
export function isPeopleBackOffice(user: Pick<AuthUser, 'roles'>): boolean {
  return hasRole(user, 'people_ops', 'it_admin');
}

export function isHighPriority(priority: Priority): boolean {
  return priority === 'critical' || priority === 'high';
}

/** en-GB short date for texts, e.g. "Tue 27 Oct". */
export function shortDate(iso: string): string {
  const date = new Date(`${iso}T12:00:00.000Z`);
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(date);
}
