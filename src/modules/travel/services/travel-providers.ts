import { Injectable } from '@nestjs/common';
import { type AuthUser, hasRole } from '@/common/auth/auth-user';
import { Clock } from '@/common/time/clock.service';
import { addDaysIso, isoDateInZone, startOfDayInZone } from '@/common/time/time';
import { AppConfig } from '@/config/app-config';
import { PrismaService } from '@/database/prisma.service';
import type { Prisma } from '@/generated/prisma/client';
import type { AttachmentPolicy } from '@/modules/core/contracts/attachment-policy.contract';
import { RegisterAttachmentPolicy } from '@/modules/core/contracts/attachment-policy.contract';
import {
  type InboxItem,
  inboxItemId,
  type InboxProvider,
  RegisterInboxProvider,
} from '@/modules/core/contracts/inbox.contract';
import {
  type MyDayContributor,
  type MyDayFragments,
  RegisterMyDayContributor,
} from '@/modules/core/contracts/my-day.contract';
import { RegisterSearchProvider, type SearchHit, type SearchProvider } from '@/modules/core/contracts/search.contract';
import { formatDate } from '../domain/travel-format';
import { isHighPriority } from '../domain/travel-rules';
import {
  KIND_LABELS,
  parseTravelReference,
  TRAVEL_BOOKING_ENTITY,
  TRAVEL_ENTITY,
  travelReference,
} from '../travel.constants';
import { TravelAccessService } from './travel-access.service';

const DAY_MS = 86_400_000;
const peopleInclude = { traveller: true } satisfies Prisma.TravelRequestInclude;

/**
 * `travel.*` inbox items (API.md §8): approvals for the approver and active deputies,
 * booking and cancellation queues for the travel desk (not it_admin). Rows about the viewer
 * never appear in their approval items (SPEC_RESOLUTIONS #13).
 */
@Injectable()
@RegisterInboxProvider()
export class TravelInboxProvider implements InboxProvider {
  readonly module = 'travel' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TravelAccessService,
    private readonly clock: Clock,
    private readonly config: AppConfig,
  ) {}

  async items(user: AuthUser): Promise<InboxItem[]> {
    const viewer = await this.access.viewer(user);
    const now = this.clock.now();
    const tz = this.clock.timeZone;
    const days = this.config.get('TRAVEL_HIGH_PRIORITY_DAYS');
    const dueAt = (d: Date) => startOfDayInZone(isoDateInZone(d, tz), tz).toISOString();
    const items: InboxItem[] = [];

    const approverIds = [user.id, ...viewer.principalIds];
    const pending = await this.prisma.travelRequest.findMany({
      where: { status: 'pending_approval', approverId: { in: approverIds }, travellerId: { not: user.id } },
      include: { ...peopleInclude, approver: true },
    });
    for (const row of pending) {
      const asDeputy = row.approverId !== user.id;
      // Quick actions = the decision subset of availableActions (approve needs a start date >= today, #11).
      const canDecide = this.access.decideRight(viewer, row) !== false;
      const startsTodayOrLater = isoDateInZone(row.startsAt, tz) >= viewer.today;
      const actions = canDecide ? [...(startsTodayOrLater ? ['approve'] : []), 'decline'] : [];
      const reasons = row.approvalReasons.length;
      items.push({
        id: inboxItemId('travel.approval_required', row.id),
        module: 'travel',
        type: 'travel.approval_required',
        reference: travelReference(row.number),
        title: `Approve ${row.kind}: ${row.traveller.displayName}`,
        subtitle: [
          row.routeSummary,
          formatDate(row.startsAt, tz),
          `${reasons} reason${reasons === 1 ? '' : 's'}`,
          ...(asDeputy && row.approver ? [`for ${row.approver.displayName}`] : []),
        ].join(' · '),
        dueAt: dueAt(row.startsAt),
        priority: isHighPriority(row.status, row.startsAt, now, days) ? 'high' : 'normal',
        actingAs: asDeputy ? 'deputy' : 'approver',
        link: `/travel/approvals?tab=${asDeputy ? 'deputy' : 'approvals'}&selected=${row.id}`,
        actionsPath: `/travel/requests/${row.id}`,
        entityId: row.id,
        createdAt: row.createdAt.toISOString(),
        quickActions: actions,
      });
    }

    if (viewer.isDesk) {
      const desk = await this.prisma.travelRequest.findMany({
        where: { status: { in: ['to_book', 'cancellation_requested'] } },
        include: peopleInclude,
      });
      for (const row of desk) {
        const base = {
          module: 'travel' as const,
          reference: travelReference(row.number),
          dueAt: dueAt(row.startsAt),
          actingAs: 'back_office' as const,
          actionsPath: `/travel/requests/${row.id}`,
          entityId: row.id,
          createdAt: row.createdAt.toISOString(),
          quickActions: [],
        };
        if (row.status === 'to_book') {
          items.push({
            ...base,
            id: inboxItemId('travel.booking_required', row.id),
            type: 'travel.booking_required',
            title: `Book ${row.kind}: ${row.routeSummary}`,
            subtitle: `${row.traveller.displayName} · ${formatDate(row.startsAt, tz)}`,
            priority: isHighPriority(row.status, row.startsAt, now, days) ? 'high' : 'normal',
            link: `/back-office/travel?queue=to_book&selected=${row.id}`,
          });
        } else {
          items.push({
            ...base,
            id: inboxItemId('travel.cancellation_review', row.id),
            type: 'travel.cancellation_review',
            title: `Cancellation: ${row.routeSummary}`,
            subtitle: `${row.traveller.displayName} · ${row.cancellationReason ?? ''}`.replace(/ · $/, ''),
            priority: row.startsAt.getTime() <= now.getTime() + 3 * DAY_MS ? 'high' : 'normal',
            link: `/back-office/travel?queue=cancellations&selected=${row.id}`,
          });
        }
      }
    }
    return items;
  }
}

/** Command-palette search (API.md §3.5): reference, route, traveller; permission-filtered. */
@Injectable()
@RegisterSearchProvider()
export class TravelSearchProvider implements SearchProvider {
  readonly module = 'travel' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TravelAccessService,
    private readonly clock: Clock,
  ) {}

  async search(user: AuthUser, q: string): Promise<SearchHit[]> {
    const viewer = await this.access.viewer(user);
    const number = parseTravelReference(q);
    const match: Prisma.TravelRequestWhereInput =
      number !== null
        ? { number }
        : {
            OR: [
              { routeSummary: { contains: q, mode: 'insensitive' } },
              { traveller: { displayName: { contains: q, mode: 'insensitive' } } },
            ],
          };
    const rows = await this.prisma.travelRequest.findMany({
      where: { AND: [this.access.visibleWhere(viewer), match] },
      include: peopleInclude,
      orderBy: { startsAt: 'desc' },
      take: 5,
    });
    return rows.map((row) => ({
      module: 'travel' as const,
      type: 'travel_request' as const,
      id: row.id,
      reference: travelReference(row.number),
      title: `${KIND_LABELS[row.kind]} ${row.routeSummary}`,
      subtitle: `${row.traveller.displayName} · ${formatDate(row.startsAt, this.clock.timeZone)}`,
      link: `/travel/requests/${row.id}`,
    }));
  }
}

/** `upcoming` on Home (API.md §7.4): my trips (traveller or companion) in the next 30 days. */
@Injectable()
@RegisterMyDayContributor()
export class TravelMyDayContributor implements MyDayContributor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async contribute(user: AuthUser): Promise<Partial<MyDayFragments>> {
    const tz = this.clock.timeZone;
    const today = this.clock.today();
    const rows = await this.prisma.travelRequest.findMany({
      where: {
        status: { in: ['pending_approval', 'to_book', 'booked'] },
        OR: [{ travellerId: user.id }, { companions: { some: { userId: user.id } } }],
        startsAt: { gte: startOfDayInZone(today, tz), lt: startOfDayInZone(addDaysIso(today, 31), tz) },
      },
      include: { booking: { select: { bookingNumber: true } } },
      orderBy: { startsAt: 'asc' },
      take: 8,
    });
    return {
      upcoming: rows.map((row) => ({
        module: 'travel' as const,
        entityId: row.id,
        kind: row.kind,
        title: row.routeSummary,
        subtitle:
          row.status === 'booked'
            ? `Booked · ${row.booking?.bookingNumber ?? ''}`.trim()
            : row.status === 'to_book'
              ? 'Waiting for the travel desk'
              : 'Awaiting approval',
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt?.toISOString() ?? null,
        status: row.status,
        link: `/travel/requests/${row.id}`,
      })),
    };
  }
}

/** Booking confirmations (`travel_booking`) are visible to whoever may view the request. */
@Injectable()
@RegisterAttachmentPolicy()
export class TravelAttachmentPolicy implements AttachmentPolicy {
  readonly entityTypes = [TRAVEL_BOOKING_ENTITY, TRAVEL_ENTITY];

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TravelAccessService,
  ) {}

  async canView(user: AuthUser, _entityType: string, entityId: string): Promise<boolean> {
    const row = await this.prisma.travelRequest.findUnique({
      where: { id: entityId },
      select: { travellerId: true, requesterId: true, approverId: true, companions: { select: { userId: true } } },
    });
    return !!row && this.access.canView(await this.access.viewer(user), row);
  }

  async canLink(user: AuthUser, entityType: string, entityId: string): Promise<boolean> {
    return hasRole(user, 'travel_desk', 'it_admin') && this.canView(user, entityType, entityId);
  }
}
