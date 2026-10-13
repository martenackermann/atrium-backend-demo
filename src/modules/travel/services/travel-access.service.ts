import { Injectable } from '@nestjs/common';
import { type AuthUser, hasRole } from '@/common/auth/auth-user';
import { Clock } from '@/common/time/clock.service';
import type { IsoDate } from '@/common/time/time';
import { PrismaService } from '@/database/prisma.service';
import type { PrismaTx } from '@/database/prisma.types';
import type { Prisma } from '@/generated/prisma/client';
import {
  canDecide,
  type DecideRight,
  isActiveDeputy,
  type OrgSnapshot,
  principalsOf,
  reportingTree,
} from '@/modules/core/approvals/approval-rules';
import { ApprovalService } from '@/modules/core/approvals/approval.service';

/** Everything needed to evaluate relationship rules for one viewer (one org snapshot). */
export interface TravelViewer {
  user: AuthUser;
  org: OrgSnapshot;
  today: IsoDate;
  /** travel_desk (back office). */
  isDesk: boolean;
  isAdmin: boolean;
  /** Principals the viewer is an active deputy for today. */
  principalIds: string[];
  /** Everyone below the viewer (any depth). */
  treeIds: Set<string>;
}

/** Row fields the rules need. */
export interface TravelAccessRow {
  travellerId: string;
  requesterId: string;
  approverId: string | null;
  companions?: { userId: string }[];
}

/**
 * Relationship rules of SPEC §3.2 (view, driver data, PIN, decide) for travel requests,
 * evaluated on one org snapshot per viewer. Approver resolution itself stays in the core
 * ApprovalService (D18); this only applies its pure predicates.
 */
@Injectable()
export class TravelAccessService {
  private readonly cache = new WeakMap<AuthUser, Promise<TravelViewer>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalService,
    private readonly clock: Clock,
  ) {}

  /**
   * Viewer context. Outside transactions it is memoised per request user object;
   * inside a transaction (`db` = tx) it is always loaded fresh through the tx.
   */
  viewer(user: AuthUser, db?: PrismaTx): Promise<TravelViewer> {
    if (db && db !== this.prisma) return this.load(user, db);
    let cached = this.cache.get(user);
    if (!cached) {
      cached = this.load(user, this.prisma);
      this.cache.set(user, cached);
    }
    return cached;
  }

  private async load(user: AuthUser, db: PrismaTx): Promise<TravelViewer> {
    const org = await this.approvals.snapshot(db);
    const today = this.clock.today();
    return {
      user,
      org,
      today,
      isDesk: hasRole(user, 'travel_desk'),
      isAdmin: hasRole(user, 'it_admin'),
      principalIds: principalsOf(org, user.id, today),
      treeIds: new Set(reportingTree(org, user.id).map((u) => u.id)),
    };
  }

  /** Back office (travel_desk) or it_admin: sees every request. */
  seesAll(viewer: TravelViewer): boolean {
    return viewer.isDesk || viewer.isAdmin;
  }

  /**
   * SPEC §3.2 "View request": traveller, companion, requester, approver, approver's active
   * deputy, anyone above the traveller (chain), travel desk, it_admin. Others -> 404.
   */
  visibleWhere(viewer: TravelViewer): Prisma.TravelRequestWhereInput {
    if (this.seesAll(viewer)) return {};
    const me = viewer.user.id;
    const or: Prisma.TravelRequestWhereInput[] = [
      { travellerId: me },
      { requesterId: me },
      { approverId: me },
      { companions: { some: { userId: me } } },
    ];
    if (viewer.principalIds.length) or.push({ approverId: { in: viewer.principalIds } });
    if (viewer.treeIds.size) or.push({ travellerId: { in: [...viewer.treeIds] } });
    return { OR: or };
  }

  canView(viewer: TravelViewer, row: TravelAccessRow): boolean {
    if (this.seesAll(viewer)) return true;
    const me = viewer.user.id;
    return (
      row.travellerId === me ||
      row.requesterId === me ||
      row.approverId === me ||
      (row.companions ?? []).some((c) => c.userId === me) ||
      this.isDeputyOfApprover(viewer, row) ||
      viewer.treeIds.has(row.travellerId)
    );
  }

  /** Driver personal data: traveller, requester, approver, approver's deputy, desk, it_admin. */
  canSeeDriver(viewer: TravelViewer, row: TravelAccessRow): boolean {
    const me = viewer.user.id;
    return (
      this.seesAll(viewer) ||
      row.travellerId === me ||
      row.requesterId === me ||
      row.approverId === me ||
      this.isDeputyOfApprover(viewer, row)
    );
  }

  /** Booking PIN (SPEC_RESOLUTIONS #24): traveller, requester, travel desk - not it_admin. */
  canViewPin(
    viewer: TravelViewer,
    row: TravelAccessRow & { status: string; booking?: { pinEncrypted: string | null } | null },
  ): boolean {
    if (!this.pinActive(row)) return false;
    const me = viewer.user.id;
    return viewer.isDesk || row.travellerId === me || row.requesterId === me;
  }

  /** A PIN exists and the booking is live (booked, or cancellation pending). */
  pinActive(row: { status: string; booking?: { pinEncrypted: string | null } | null }): boolean {
    return !!row.booking?.pinEncrypted && (row.status === 'booked' || row.status === 'cancellation_requested');
  }

  /** SPEC §6.2 for the travel approval step (a manager step). */
  decideRight(viewer: TravelViewer, row: TravelAccessRow): DecideRight | false {
    if (!row.approverId) return false;
    return canDecide(
      viewer.org,
      viewer.user.id,
      { kind: 'manager', approverId: row.approverId, subjectId: row.travellerId },
      viewer.today,
    );
  }

  /** Creating for others (SPEC §6.4): self or reporting tree; desk and it_admin are exempt. */
  mayCreateFor(viewer: TravelViewer, travellerId: string): boolean {
    return this.seesAll(viewer) || travellerId === viewer.user.id || viewer.treeIds.has(travellerId);
  }

  private isDeputyOfApprover(viewer: TravelViewer, row: TravelAccessRow): boolean {
    return (
      !!row.approverId &&
      isActiveDeputy(viewer.org, viewer.user.id, row.approverId, viewer.today, { allowInactivePrincipal: true })
    );
  }
}
