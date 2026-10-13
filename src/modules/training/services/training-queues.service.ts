import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import type { AppAbility } from '@/common/authz/ability.types';
import { Clock } from '@/common/time/clock.service';
import { addDaysIso, dateFromIso, isoFromDate } from '@/common/time/time';
import { AppConfig } from '@/config/app-config';
import { PrismaService } from '@/database/prisma.service';
import type { ExportParticipationsQueryDto } from '../dto/training-request.dto';
import type { TrainingCountsView } from '../dto/training-response.schemas';
import { ACTIVE_STATUSES, csvMoney, trainingReference } from '../training.constants';
import { TrainingAccess } from './training-access.service';
import { RATEABLE_ATTENDEE } from './training-ratings.service';
import { TrainingParticipationsService } from './training-participations.service';
import { approverReasonLabel, stateLabel } from './training-notifier.service';

/** `GET /training/queues/counts` and the participation CSV export. */
@Injectable()
export class TrainingQueuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TrainingAccess,
    private readonly participations: TrainingParticipationsService,
    private readonly config: AppConfig,
    private readonly clock: Clock,
  ) {}

  async counts(user: AuthUser, ability: AppAbility): Promise<TrainingCountsView> {
    const viewer = await this.access.viewer(user, ability);
    const now = this.clock.now();
    const today = viewer.today;
    const overdueBefore = new Date(now.getTime() - this.config.get('RATING_OVERDUE_DAYS') * 86_400_000);
    const p = this.prisma.trainingAttendee;
    const goalsHorizon = addDaysIso(today, this.config.get('GOALS_REMINDER_DAYS_BEFORE'));

    const [active, ratingsDue, goalsMissing, manager, executive, deputy, teamPending] = await Promise.all([
      p.count({ where: { userId: user.id, status: { in: [...ACTIVE_STATUSES] } } }),
      this.prisma.trainingRating.count({
        where: { raterId: user.id, submittedAt: null, dueAt: { lte: now }, ...RATEABLE_ATTENDEE },
      }),
      p.count({
        where: {
          userId: user.id,
          status: 'booked',
          goal1: null,
          goal2: null,
          request: { startsOn: { gt: dateFromIso(today), lte: dateFromIso(goalsHorizon) } },
        },
      }),
      p.count({ where: this.participations.scopeWhere('approvals', viewer) }),
      p.count({ where: this.participations.scopeWhere('executive', viewer) }),
      p.count({ where: this.participations.scopeWhere('deputy', viewer) }),
      viewer.treeIds.length
        ? p.findMany({
            where: {
              userId: { in: viewer.treeIds },
              status: { in: ['pending_manager_approval', 'pending_executive_approval'] },
            },
            select: { status: true, approverId: true, executiveApproverId: true, userId: true },
          })
        : Promise.resolve([]),
    ]);
    // Team badge: pending rows in my tree I can decide only through the manager-chain override.
    const team = teamPending.filter(
      (r) =>
        r.status === 'pending_manager_approval' &&
        r.approverId &&
        viewer.canDecide({ kind: 'manager', approverId: r.approverId, subjectId: r.userId }) === 'manager_chain',
    ).length;

    let office: TrainingCountsView['office'] = null;
    if (viewer.isBackOffice) {
      const [toBook, cancellationRequested, pendingApproval, bookingImpossible, ratingsOverdue, billingOpen] =
        await Promise.all([
          p.count({ where: { status: 'to_book' } }),
          p.count({ where: { status: 'cancellation_requested' } }),
          p.count({ where: { status: { in: ['pending_manager_approval', 'pending_executive_approval'] } } }),
          p.count({ where: { status: 'booking_impossible' } }),
          this.prisma.trainingRating.count({ where: { submittedAt: null, dueAt: { lt: overdueBefore } } }),
          this.prisma.trainingRequest.count({
            where: { billingStatus: 'open', attendees: { some: { status: { in: ['booked', 'attended'] } } } },
          }),
        ]);
      office = { toBook, cancellationRequested, pendingApproval, bookingImpossible, ratingsOverdue, billingOpen };
    }

    return {
      mine: { active, ratingsDue, goalsMissing },
      approvals: { manager, executive, deputy, team },
      office,
    };
  }

  /** CSV (API.md §1): UTF-8 with BOM, comma separator, header row, ISO dates, decimal euros. */
  async exportCsv(user: AuthUser, ability: AppAbility, query: ExportParticipationsQueryDto): Promise<string> {
    const rows = await this.participations.exportRows(user, ability, query);
    const header = [
      'reference',
      'topic',
      'provider',
      'format',
      'startsOn',
      'endsOn',
      'attendee',
      'attendeeEmail',
      'costCentre',
      'status',
      'approver',
      'approverReason',
      'executiveApprover',
      'costPerAttendee',
      'hotelCheckIn',
      'hotelCheckOut',
      'hotelCost',
      'bookingReference',
      'billingStatus',
      'actualCost',
      'requester',
      'createdAt',
    ];
    const lines = rows.map((r) =>
      [
        trainingReference(r.request.number),
        r.request.topic,
        r.request.provider,
        r.request.format,
        isoFromDate(r.request.startsOn),
        isoFromDate(r.request.endsOn),
        r.user.displayName,
        r.user.email,
        r.costCenter.code,
        stateLabel(r.status),
        r.approver?.displayName ?? '',
        approverReasonLabel(r.approverReason),
        r.executiveApprover?.displayName ?? '',
        csvMoney(r.request.costCents),
        r.hotelCheckInOn ? isoFromDate(r.hotelCheckInOn) : '',
        r.hotelCheckOutOn ? isoFromDate(r.hotelCheckOutOn) : '',
        csvMoney(r.hotelCostCents),
        r.bookingReference ?? '',
        r.request.billingStatus,
        csvMoney(r.request.actualCostCents),
        r.request.requester.displayName,
        r.createdAt.toISOString(),
      ]
        .map(csvCell)
        .join(','),
    );
    return `﻿${[header.join(','), ...lines].join('\r\n')}\r\n`;
  }
}

/** Quotes a CSV cell when needed and neutralises spreadsheet formulas. */
export function csvCell(value: string): string {
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
