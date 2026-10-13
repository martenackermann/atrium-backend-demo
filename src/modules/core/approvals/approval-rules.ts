import type { ActingAs, ApproverReason, AutoApproval } from '@/common/domain/vocabulary';
import { type IsoDate, withinWindow } from '@/common/time/time';

/**
 * Pure implementations of SPEC §6.1 (approver resolution) and §6.2 (who may decide an
 * approval step). They work on an in-memory snapshot of the org (52 users in the demo),
 * so they are easy to unit test; ApprovalService feeds them from the database.
 */

export const MAX_CHAIN_DEPTH = 10;

export interface OrgUser {
  id: string;
  displayName: string;
  email: string;
  jobTitle: string | null;
  firstName?: string;
  lastName?: string;
  active: boolean;
  isSiteManager: boolean;
  isExecutive: boolean;
  managerId: string | null;
}

export interface DeputyWindow {
  principalId: string;
  deputyId: string;
  validFrom: IsoDate | null;
  validTo: IsoDate | null;
}

export class OrgSnapshot {
  private readonly byId = new Map<string, OrgUser>();
  private readonly byEmailMap = new Map<string, OrgUser>();

  constructor(
    users: readonly OrgUser[],
    readonly deputies: readonly DeputyWindow[] = [],
  ) {
    for (const user of users) {
      this.byId.set(user.id, user);
      this.byEmailMap.set(user.email.toLowerCase(), user);
    }
  }

  get(id: string | null | undefined): OrgUser | undefined {
    return id ? this.byId.get(id) : undefined;
  }

  require(id: string): OrgUser {
    const user = this.byId.get(id);
    if (!user) throw new Error(`Unknown user ${id}`);
    return user;
  }

  byEmail(email: string): OrgUser | undefined {
    return this.byEmailMap.get(email.toLowerCase());
  }

  manager(user: OrgUser): OrgUser | undefined {
    return this.get(user.managerId);
  }

  all(): OrgUser[] {
    return [...this.byId.values()];
  }
}

export interface ApproverResolution {
  approver: OrgUser;
  reason: ApproverReason;
  auto: AutoApproval | null;
  /** First site manager skipped on the way up (SPEC_RESOLUTIONS #2), else null. */
  escalatedFromId: string | null;
}

/** SPEC §6.1. `fallbackEmail` = FALLBACK_APPROVER_EMAIL. */
export function resolveApprover(
  org: OrgSnapshot,
  subjectId: string,
  requesterId: string,
  fallbackEmail: string,
): ApproverResolution {
  const subject = org.require(subjectId);
  if (subject.isExecutive) {
    return { approver: subject, reason: 'executive_self', auto: 'executive_self', escalatedFromId: null };
  }

  let candidate = org.manager(subject);
  let reason: ApproverReason = 'direct_manager';
  let escalatedFromId: string | null = null;
  let hops = 0;
  while (candidate && hops < MAX_CHAIN_DEPTH) {
    if (!candidate.active) {
      candidate = org.manager(candidate);
      reason = 'manager_unavailable';
      hops++;
      continue;
    }
    if (candidate.isSiteManager && candidate.managerId !== null) {
      escalatedFromId ??= candidate.id;
      candidate = org.manager(candidate);
      reason = 'site_manager_escalation';
      hops++;
      continue;
    }
    break;
  }

  // A site manager at the top of the tree (or an exhausted/invalid chain) falls back.
  if (!candidate || candidate.id === subject.id || candidate.isSiteManager || !candidate.active) {
    const fallback = org.byEmail(fallbackEmail);
    if (!fallback?.active) throw new Error(`Fallback approver ${fallbackEmail} is missing or inactive`);
    if (fallback.id === subject.id) {
      return { approver: subject, reason: 'executive_self', auto: 'executive_self', escalatedFromId };
    }
    candidate = fallback;
    reason = 'fallback';
  }

  return {
    approver: candidate,
    reason,
    auto: requesterId === candidate.id ? 'requester_is_approver' : null,
    escalatedFromId,
  };
}

/** Managers above `userId` (nearest first), skipping inactive users, max depth 10. */
export function activeAncestors(org: OrgSnapshot, userId: string): OrgUser[] {
  const result: OrgUser[] = [];
  const seen = new Set<string>([userId]);
  let current = org.manager(org.require(userId));
  for (let depth = 0; current && depth < MAX_CHAIN_DEPTH && !seen.has(current.id); depth++) {
    seen.add(current.id);
    if (current.active) result.push(current);
    current = org.manager(current);
  }
  return result;
}

/** All managers above `userId` (nearest first, active or not), max depth 10. */
export function managementChain(org: OrgSnapshot, userId: string): OrgUser[] {
  const result: OrgUser[] = [];
  const seen = new Set<string>([userId]);
  let current = org.manager(org.require(userId));
  for (let depth = 0; current && depth < MAX_CHAIN_DEPTH && !seen.has(current.id); depth++) {
    seen.add(current.id);
    result.push(current);
    current = org.manager(current);
  }
  return result;
}

/**
 * Deputy is active on `day` when the window contains it and both users are active (SPEC §4.1).
 * `allowInactivePrincipal`: a deputy may still decide a deactivated principal's step (SPEC_RESOLUTIONS #12).
 */
export function isActiveDeputy(
  org: OrgSnapshot,
  deputyId: string,
  principalId: string,
  day: IsoDate,
  options: { allowInactivePrincipal?: boolean } = {},
): boolean {
  if (!org.get(deputyId)?.active) return false;
  if (!options.allowInactivePrincipal && !org.get(principalId)?.active) return false;
  return org.deputies.some(
    (d) => d.deputyId === deputyId && d.principalId === principalId && withinWindow(day, d.validFrom, d.validTo),
  );
}

/** Principals for whom `deputyId` is an active deputy on `day`. */
export function principalsOf(org: OrgSnapshot, deputyId: string, day: IsoDate): string[] {
  return [
    ...new Set(
      org.deputies
        .filter((d) => d.deputyId === deputyId && isActiveDeputy(org, deputyId, d.principalId, day))
        .map((d) => d.principalId),
    ),
  ];
}

/** Active deputies of `principalId` on `day`. */
export function activeDeputiesOf(org: OrgSnapshot, principalId: string, day: IsoDate): OrgUser[] {
  const ids = new Set(
    org.deputies
      .filter((d) => d.principalId === principalId && isActiveDeputy(org, d.deputyId, principalId, day))
      .map((d) => d.deputyId),
  );
  return [...ids].map((id) => org.require(id));
}

export type ApprovalStepKind = 'manager' | 'executive';

export interface ApprovalStep {
  kind: ApprovalStepKind;
  approverId: string;
  /** The person the approval is about (attendee, traveller). Nobody decides their own step. */
  subjectId: string;
}

export type DecideRight = Extract<ActingAs, 'approver' | 'executive' | 'deputy' | 'manager_chain'>;

/**
 * SPEC §6.2. Returns how the actor may decide (`actingAs` for the audit log) or false.
 * The named executive decides executive steps as 'executive' (SPEC_RESOLUTIONS #13).
 * The manager-chain override (D9) applies to manager steps only. Roles (e.g. it_admin)
 * never grant approval rights (#12).
 */
export function canDecide(org: OrgSnapshot, actorId: string, step: ApprovalStep, day: IsoDate): DecideRight | false {
  if (actorId === step.subjectId) return false;
  if (!org.get(actorId)?.active) return false;
  if (actorId === step.approverId) return step.kind === 'executive' ? 'executive' : 'approver';
  if (isActiveDeputy(org, actorId, step.approverId, day, { allowInactivePrincipal: true })) return 'deputy';
  if (step.kind === 'manager' && org.get(step.approverId)) {
    if (activeAncestors(org, step.approverId).some((u) => u.id === actorId)) return 'manager_chain';
  }
  return false;
}

/** Everyone below `managerId` (any depth), active or not. */
export function reportingTree(org: OrgSnapshot, managerId: string): OrgUser[] {
  const children = new Map<string, OrgUser[]>();
  for (const user of org.all()) {
    if (!user.managerId) continue;
    const list = children.get(user.managerId) ?? [];
    list.push(user);
    children.set(user.managerId, list);
  }
  const result: OrgUser[] = [];
  const queue = [...(children.get(managerId) ?? [])];
  const seen = new Set<string>([managerId]);
  while (queue.length) {
    const next = queue.shift()!;
    if (seen.has(next.id)) continue;
    seen.add(next.id);
    result.push(next);
    queue.push(...(children.get(next.id) ?? []));
  }
  return result;
}
