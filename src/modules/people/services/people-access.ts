import type { AuthUser } from '@/common/auth/auth-user';
import { hasRole } from '@/common/auth/auth-user';
import type { Prisma } from '@/generated/prisma/client';
import { CLOSED_STATUSES, isPeopleBackOffice, type PeopleRequestStatus } from '../people.constants';

/** Relations every people-request response needs. */
export const peopleRequestInclude = {
  jobRole: true,
  subjectUser: true,
  department: true,
  site: true,
  manager: true,
  managerDeputy: true,
  requester: true,
  assignee: true,
} satisfies Prisma.PeopleRequestInclude;

export type PeopleRequestRow = Prisma.PeopleRequestGetPayload<{ include: typeof peopleRequestInclude }>;

type Relations = Pick<PeopleRequestRow, 'requesterId' | 'managerId' | 'managerDeputyId'>;

/**
 * SPEC §3.4 visibility: requester, the subject's manager, the manager's deputy (read only),
 * people_ops and it_admin. The subject of an offboarding/role change does not see it.
 */
export function visibleWhere(user: AuthUser): Prisma.PeopleRequestWhereInput {
  if (isPeopleBackOffice(user)) return {};
  return { OR: [{ requesterId: user.id }, { managerId: user.id }, { managerDeputyId: user.id }] };
}

/** `scope=mine`: requester, manager or manager's deputy is me (API.md §7.1). */
export function mineWhere(user: AuthUser): Prisma.PeopleRequestWhereInput {
  return { OR: [{ requesterId: user.id }, { managerId: user.id }, { managerDeputyId: user.id }] };
}

export function canView(user: AuthUser, row: Relations): boolean {
  return (
    isPeopleBackOffice(user) ||
    row.requesterId === user.id ||
    row.managerId === user.id ||
    row.managerDeputyId === user.id
  );
}

/**
 * Personal data (and people documents, SPEC_RESOLUTIONS #25): requester, manager and
 * people_ops. it_admin and the manager's deputy see it redacted (D13).
 */
export function canSeePersonalData(user: AuthUser, row: Relations): boolean {
  return hasRole(user, 'people_ops') || row.requesterId === user.id || row.managerId === user.id;
}

export function isClosed(status: PeopleRequestStatus): boolean {
  return CLOSED_STATUSES.includes(status);
}

/** `edit`: requester while open, back office while not closed (SPEC_RESOLUTIONS #24). */
export function canEdit(user: AuthUser, row: Relations & { status: PeopleRequestStatus }): boolean {
  if (isPeopleBackOffice(user)) return !isClosed(row.status);
  return row.requesterId === user.id && row.status === 'open';
}

/** Public comments: requester, manager, back office - while the request is not closed. */
export function canComment(user: AuthUser, row: Relations & { status: PeopleRequestStatus }): boolean {
  if (isClosed(row.status)) return false;
  return isPeopleBackOffice(user) || row.requesterId === user.id || row.managerId === user.id;
}
