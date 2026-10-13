import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import { hasRole } from '@/common/auth/auth-user';
import { Clock } from '@/common/time/clock.service';
import type { IsoDate } from '@/common/time/time';
import type { PrismaTx } from '@/database/prisma.types';
import type { Prisma } from '@/generated/prisma/client';
import {
  type ApprovalStep,
  canDecide,
  type DecideRight,
  OrgSnapshot,
  principalsOf,
  reportingTree,
} from '@/modules/core/approvals/approval-rules';
import { ApprovalService } from '@/modules/core/approvals/approval.service';

/**
 * What the current user's relationships look like today: an org snapshot (52 users),
 * the principals they deputise for, their reporting tree and their back-office roles.
 * Built once per request (cached per key object, e.g. the request's CASL ability) and
 * used for visibility filters, scopes and the approval checks (ApprovalService rules).
 */
export class TrainingViewer {
  readonly principals: string[];
  readonly treeIds: string[];
  /** training_office or it_admin: sees every row, runs the office queues. */
  readonly isBackOffice: boolean;
  /** training_office (queue owner; it_admin is a supervisor without inbox items). */
  readonly isTrainingOffice: boolean;

  constructor(
    readonly user: AuthUser,
    readonly org: OrgSnapshot,
    readonly today: IsoDate,
  ) {
    this.principals = principalsOf(org, user.id, today);
    this.treeIds = reportingTree(org, user.id).map((u) => u.id);
    this.isBackOffice = hasRole(user, 'training_office', 'it_admin');
    this.isTrainingOffice = hasRole(user, 'training_office');
  }

  get id(): string {
    return this.user.id;
  }

  /** SPEC §6.2 via the core rules: 'approver' | 'executive' | 'deputy' | 'manager_chain' | false. */
  canDecide(step: ApprovalStep): DecideRight | false {
    return canDecide(this.org, this.user.id, step, this.today);
  }

  /** May the viewer name `userId` as an attendee (self or reporting tree; back office exempt)? */
  mayActFor(userId: string): boolean {
    return this.isBackOffice || userId === this.user.id || this.treeIds.includes(userId);
  }

  isInTree(userId: string): boolean {
    return this.treeIds.includes(userId);
  }

  /**
   * Attendee rows the viewer may see (SPEC §3.1): own row, requester, step approvers and
   * their active deputies, deciders, the attendee's management chain, raters; back office all.
   */
  attendeeWhere(): Prisma.TrainingAttendeeWhereInput {
    if (this.isBackOffice) return {};
    const me = this.user.id;
    const approvers = [me, ...this.principals];
    return {
      OR: [
        { userId: me },
        { request: { requesterId: me } },
        { approverId: { in: approvers } },
        { executiveApproverId: { in: approvers } },
        { managerDecisionById: me },
        { executiveDecisionById: me },
        ...(this.treeIds.length ? [{ userId: { in: this.treeIds } }] : []),
        { ratings: { some: { raterId: me } } },
      ],
    };
  }

  /** Requests the viewer may see: requester, or at least one visible attendee row. */
  requestWhere(): Prisma.TrainingRequestWhereInput {
    if (this.isBackOffice) return {};
    return { OR: [{ requesterId: this.user.id }, { attendees: { some: this.attendeeWhere() } }] };
  }

  /** Rating rows the viewer may open: rater, back office, or the attendee for loops 1-2. */
  ratingWhere(): Prisma.TrainingRatingWhereInput {
    if (this.isBackOffice) return {};
    return { OR: [{ raterId: this.user.id }, { loop: { in: [1, 2] }, attendee: { userId: this.user.id } }] };
  }
}

@Injectable()
export class TrainingAccess {
  private readonly cache = new WeakMap<object, Promise<TrainingViewer>>();

  constructor(
    private readonly approvals: ApprovalService,
    private readonly clock: Clock,
  ) {}

  /**
   * The viewer context. Pass a per-request `key` (the CASL ability) to reuse one org snapshot
   * for every row of a response; pass `db` to read inside a transaction (no caching then).
   */
  viewer(user: AuthUser, key?: object, db?: PrismaTx): Promise<TrainingViewer> {
    if (db || !key) return this.build(user, db);
    let cached = this.cache.get(key);
    if (!cached) {
      cached = this.build(user);
      this.cache.set(key, cached);
    }
    return cached;
  }

  async org(db?: PrismaTx): Promise<OrgSnapshot> {
    return this.approvals.snapshot(db);
  }

  private async build(user: AuthUser, db?: PrismaTx): Promise<TrainingViewer> {
    return new TrainingViewer(user, await this.approvals.snapshot(db), this.clock.today());
  }
}
