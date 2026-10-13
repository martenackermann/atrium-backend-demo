import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { toUserRef } from '@/common/domain/mappers';
import type { ApprovalExemptionCode, ApproverReason } from '@/common/domain/vocabulary';
import { RequestContext } from '@/common/http/request-context';
import { Clock } from '@/common/time/clock.service';
import { type IsoDate, isoFromDateOrNull } from '@/common/time/time';
import { AppConfig } from '@/config/app-config';
import { PrismaService } from '@/database/prisma.service';
import type { PrismaTx } from '@/database/prisma.types';
import {
  activeAncestors,
  activeDeputiesOf,
  type ApprovalStep,
  type ApproverResolution,
  canDecide,
  type DecideRight,
  isActiveDeputy,
  managementChain,
  OrgSnapshot,
  type OrgUser,
  principalsOf,
  reportingTree,
  resolveApprover,
} from './approval-rules';

export interface ApproverCandidateView {
  user: ReturnType<typeof toUserRef>;
  level: number;
  isSiteManager: boolean;
  isDefault: boolean;
  selectable: boolean;
  reason: ApproverReason | null;
}

export interface ApproverChainView {
  subject: ReturnType<typeof toUserRef>;
  exemption: ApprovalExemptionCode | null;
  default: ApproverCandidateView | null;
  candidates: ApproverCandidateView[];
}

/**
 * Shared approval rules for every module (D18): approver resolution (§6.1), the
 * "may decide" check (§6.2), deputies and reporting trees. Training (A1) and Travel (A2)
 * call this service; never re-implement the rules in a slice.
 */
export interface ApproverResolutionView {
  approverId: string;
  approver: OrgUser;
  reason: ApproverResolution['reason'];
  auto: ApproverResolution['auto'];
  /** First site manager skipped on the way up; persist it next to approverId. */
  escalatedFromId: string | null;
}

const ORG_SNAPSHOT_KEY = 'approvals.org-snapshot';

/** Drops the request's cached org snapshot - call after writing users, roles or deputies. */
export function forgetOrgSnapshot(): void {
  RequestContext.forget(ORG_SNAPSHOT_KEY);
}

@Injectable()
export class ApprovalService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ApprovalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly clock: Clock,
  ) {}

  /**
   * The whole org (users + deputies) - small enough for the demo (52 users). Loaded once per HTTP
   * request (a list page asks for many approval decisions); writers of users/deputies call
   * `forgetOrgSnapshot()`.
   */
  snapshot(db: PrismaTx = this.prisma): Promise<OrgSnapshot> {
    return RequestContext.memo(ORG_SNAPSHOT_KEY, () => this.loadSnapshot(db));
  }

  private async loadSnapshot(db: PrismaTx): Promise<OrgSnapshot> {
    // Sequential: inside an interactive transaction both queries share one connection.
    const users = await db.user.findMany({
      select: {
        id: true,
        displayName: true,
        email: true,
        jobTitle: true,
        firstName: true,
        lastName: true,
        active: true,
        isSiteManager: true,
        managerId: true,
        roles: { where: { role: 'executive' }, select: { role: true } },
      },
    });
    const deputies = await db.deputy.findMany({
      select: { principalId: true, deputyId: true, validFrom: true, validTo: true },
    });
    return new OrgSnapshot(
      users.map(({ roles, ...u }) => ({ ...u, isExecutive: roles.length > 0 })),
      deputies.map((d) => ({ ...d, validFrom: isoFromDateOrNull(d.validFrom), validTo: isoFromDateOrNull(d.validTo) })),
    );
  }

  /** SPEC_RESOLUTIONS #12: the fallback approver must be an active executive. Logged, not fatal (empty DB before seeding). */
  async onApplicationBootstrap(): Promise<void> {
    const email = this.config.get('FALLBACK_APPROVER_EMAIL');
    if ((await this.prisma.user.count()) === 0) return;
    const fallback = await this.prisma.user.findUnique({ where: { email }, include: { roles: true } });
    if (!fallback?.active || !fallback.roles.some((r) => r.role === 'executive')) {
      this.logger.error(`FALLBACK_APPROVER_EMAIL ${email} is not an active executive - approver resolution will fail`);
    }
  }

  /**
   * SPEC §6.1 - compute once at creation and store `approverId`, `approverReason` and
   * `escalatedFromId`. `auto` is 'requester_is_approver' when `requesterId` is the approver.
   */
  async resolveApprover(
    subjectId: string,
    requesterId: string = subjectId,
    db?: PrismaTx,
  ): Promise<ApproverResolutionView> {
    const r = resolveApprover(
      await this.snapshot(db),
      subjectId,
      requesterId,
      this.config.get('FALLBACK_APPROVER_EMAIL'),
    );
    return {
      approverId: r.approver.id,
      approver: r.approver,
      reason: r.reason,
      auto: r.auto,
      escalatedFromId: r.escalatedFromId,
    };
  }

  /**
   * SPEC §6.2 - may `userId` decide this step today? Returns the actingAs for the audit log
   * (`approver` | `executive` | `deputy` | `manager_chain`) or false.
   */
  async canDecide(userId: string, step: ApprovalStep, db?: PrismaTx): Promise<DecideRight | false> {
    return canDecide(await this.snapshot(db), userId, step, this.clock.today());
  }

  /** Is `deputyId` an active deputy of `principalId` on `at` (default today)? */
  async isActiveDeputy(deputyId: string, principalId: string, at?: IsoDate, db?: PrismaTx): Promise<boolean> {
    return isActiveDeputy(await this.snapshot(db), deputyId, principalId, at ?? this.clock.today());
  }

  /** Active deputies of a user today (cc recipients of approval notifications). */
  async activeDeputiesOf(userId: string, db?: PrismaTx): Promise<OrgUser[]> {
    return activeDeputiesOf(await this.snapshot(db), userId, this.clock.today());
  }

  /** Active managers above the user (nearest first). */
  async ancestors(userId: string, db?: PrismaTx): Promise<OrgUser[]> {
    return activeAncestors(await this.snapshot(db), userId);
  }

  /** Is `userId` anywhere below `managerId`? */
  async isInReportingTree(managerId: string, userId: string, db?: PrismaTx): Promise<boolean> {
    return (await this.reportingTreeIds(managerId, db)).includes(userId);
  }

  /** Principals the user currently stands in for. */
  async principalsOf(deputyId: string, db?: PrismaTx): Promise<string[]> {
    return principalsOf(await this.snapshot(db), deputyId, this.clock.today());
  }

  /**
   * Approver ids whose steps appear in the user's own approval inbox: themselves plus every
   * principal they are an active deputy for (the manager chain sees items in "Team" views only).
   * Use as `where: { approverId: { in: ids } }`.
   */
  async inboxApproverIds(userId: string, db?: PrismaTx): Promise<{ self: string; asDeputyFor: string[] }> {
    return { self: userId, asDeputyFor: await this.principalsOf(userId, db) };
  }

  /** Ids of everyone below the manager (any depth). */
  async reportingTreeIds(managerId: string, db?: PrismaTx): Promise<string[]> {
    return reportingTree(await this.snapshot(db), managerId).map((u) => u.id);
  }

  /**
   * "Creating for others" rule (SPEC §6.4): self or anyone in the actor's reporting tree.
   * Back-office roles and it_admin are exempt - check that in the slice before calling.
   */
  async mayActFor(actorId: string, subjectId: string, db?: PrismaTx): Promise<boolean> {
    return actorId === subjectId || this.isInReportingTree(actorId, subjectId, db);
  }

  /** `GET /users/{id}/approvers` (API.md §3.3). */
  async approverChain(subjectId: string, db?: PrismaTx): Promise<ApproverChainView> {
    const org = await this.snapshot(db);
    const subject = org.require(subjectId);
    const chain = managementChain(org, subjectId);
    const exempt = subject.isExecutive;
    const resolved = exempt
      ? null
      : resolveApprover(org, subjectId, subjectId, this.config.get('FALLBACK_APPROVER_EMAIL'));

    const candidates: ApproverCandidateView[] = chain.map((u, index) => this.candidate(u, index + 1, resolved));
    if (resolved && !candidates.some((c) => c.isDefault)) {
      candidates.push(this.candidate(resolved.approver, candidates.length + 1, resolved));
    }
    return {
      subject: toUserRef(subject),
      exemption: exempt ? 'executive_traveller' : null,
      default: candidates.find((c) => c.isDefault) ?? null,
      candidates,
    };
  }

  private candidate(user: OrgUser, level: number, resolved: ApproverResolution | null): ApproverCandidateView {
    const isDefault = resolved?.approver.id === user.id;
    return {
      user: toUserRef(user),
      level,
      isSiteManager: user.isSiteManager,
      isDefault,
      selectable: user.active && !user.isSiteManager,
      reason: isDefault ? resolved.reason : null,
    };
  }
}
