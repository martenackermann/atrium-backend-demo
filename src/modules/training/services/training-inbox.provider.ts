import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import { Clock } from '@/common/time/clock.service';
import { addDaysIso, dateFromIso, isoFromDate, startOfDayInZone } from '@/common/time/time';
import { AppConfig } from '@/config/app-config';
import { PrismaService } from '@/database/prisma.service';
import {
  type InboxItem,
  inboxItemId,
  type InboxProvider,
  RegisterInboxProvider,
} from '@/modules/core/contracts/inbox.contract';
import {
  formatDate,
  formatDateRange,
  formatMoney,
  isHighPriority,
  ratingState,
  trainingReference,
} from '../training.constants';
import { TrainingAccess } from './training-access.service';
import { RATEABLE_ATTENDEE } from './training-ratings.service';

const attendeeSelect = {
  id: true,
  status: true,
  userId: true,
  approverId: true,
  executiveApproverId: true,
  cancellationReason: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { displayName: true } },
  request: { select: { number: true, topic: true, provider: true, startsOn: true, endsOn: true, costCents: true } },
} as const;

/**
 * Training to-dos for `/me/inbox` (API.md §8): approvals (approver, executive, active deputy;
 * never the viewer's own participation), office booking / cancellation queues (training_office
 * only, not it_admin), due ratings and missing goals.
 */
@Injectable()
@RegisterInboxProvider()
export class TrainingInboxProvider implements InboxProvider {
  readonly module = 'training' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TrainingAccess,
    private readonly config: AppConfig,
    private readonly clock: Clock,
  ) {}

  async items(user: AuthUser): Promise<InboxItem[]> {
    const viewer = await this.access.viewer(user);
    const today = viewer.today;
    const tz = this.clock.timeZone;
    const highDays = this.config.get('TRAINING_HIGH_PRIORITY_DAYS');
    const due = (d: Date) => startOfDayInZone(isoFromDate(d), tz).toISOString();
    const items: InboxItem[] = [];
    const approvers = [user.id, ...viewer.principals];

    // Approvals: I'm the step approver or an active deputy of it.
    const pending = await this.prisma.trainingAttendee.findMany({
      where: {
        userId: { not: user.id },
        OR: [
          { status: 'pending_manager_approval', approverId: { in: approvers } },
          { status: 'pending_executive_approval', executiveApproverId: { in: approvers } },
        ],
      },
      select: attendeeSelect,
    });
    for (const row of pending) {
      const exec = row.status === 'pending_executive_approval';
      const stepApprover = exec ? row.executiveApproverId : row.approverId;
      const asDeputy = stepApprover !== user.id;
      const principal = asDeputy ? viewer.org.get(stepApprover)?.displayName : null;
      const startsOn = isoFromDate(row.request.startsOn);
      const tab = asDeputy ? 'deputy' : exec ? 'executive' : 'approvals';
      const subtitle = [
        row.request.topic,
        formatDateRange(startsOn, isoFromDate(row.request.endsOn), today),
        formatMoney(row.request.costCents),
      ].join(' · ');
      items.push({
        id: inboxItemId('training.approval_required', row.id),
        module: 'training',
        type: 'training.approval_required',
        reference: trainingReference(row.request.number),
        title: `Approve training: ${row.user.displayName}`,
        subtitle: `${subtitle}${principal ? ` · for ${principal}` : ''}${exec ? ' · executive step' : ''}`,
        dueAt: due(row.request.startsOn),
        priority: isHighPriority(row.status, startsOn, today, highDays) ? 'high' : 'normal',
        actingAs: asDeputy ? 'deputy' : exec ? 'executive' : 'approver',
        link: `/training/approvals?tab=${tab}&selected=${row.id}`,
        actionsPath: `/training/participations/${row.id}`,
        entityId: row.id,
        createdAt: row.updatedAt.toISOString(),
        // Past-start items can only be declined (SPEC_RESOLUTIONS #11).
        quickActions: startsOn >= today ? ['approve', 'decline'] : ['decline'],
      });
    }

    // Office queues (queue owners only; it_admin is a supervisor without inbox items).
    if (viewer.isTrainingOffice) {
      const office = await this.prisma.trainingAttendee.findMany({
        where: { status: { in: ['to_book', 'cancellation_requested'] } },
        select: attendeeSelect,
      });
      for (const row of office) {
        const startsOn = isoFromDate(row.request.startsOn);
        if (row.status === 'to_book') {
          items.push({
            id: inboxItemId('training.booking_required', row.id),
            module: 'training',
            type: 'training.booking_required',
            reference: trainingReference(row.request.number),
            title: `Book: ${row.request.topic}`,
            subtitle: `${row.user.displayName} · ${row.request.provider}`,
            dueAt: due(row.request.startsOn),
            priority: isHighPriority(row.status, startsOn, today, highDays) ? 'high' : 'normal',
            actingAs: 'back_office',
            link: `/back-office/training?queue=to_book&selected=${row.id}`,
            actionsPath: `/training/participations/${row.id}`,
            entityId: row.id,
            createdAt: row.updatedAt.toISOString(),
            quickActions: [],
          });
        } else {
          items.push({
            id: inboxItemId('training.cancellation_review', row.id),
            module: 'training',
            type: 'training.cancellation_review',
            reference: trainingReference(row.request.number),
            title: `Cancellation: ${row.request.topic}`,
            subtitle: `${row.user.displayName}${row.cancellationReason ? ` · ${row.cancellationReason}` : ''}`,
            dueAt: due(row.request.startsOn),
            priority: startsOn >= today && startsOn <= addDaysIso(today, 3) ? 'high' : 'normal',
            actingAs: 'back_office',
            link: `/back-office/training?queue=cancellations&selected=${row.id}`,
            actionsPath: `/training/participations/${row.id}`,
            entityId: row.id,
            createdAt: row.updatedAt.toISOString(),
            quickActions: [],
          });
        }
      }
    }

    // Ratings due or overdue where I'm the rater.
    const now = this.clock.now();
    const overdueDays = this.config.get('RATING_OVERDUE_DAYS');
    const ratings = await this.prisma.trainingRating.findMany({
      where: { raterId: user.id, submittedAt: null, dueAt: { lte: now }, ...RATEABLE_ATTENDEE },
      include: { attendee: { select: attendeeSelect } },
    });
    for (const rating of ratings) {
      const row = rating.attendee;
      const state = ratingState(rating, now, overdueDays);
      items.push({
        id: inboxItemId('training.rating_due', rating.id),
        module: 'training',
        type: 'training.rating_due',
        reference: trainingReference(row.request.number),
        title:
          rating.loop === 3
            ? `Rate ${row.user.displayName}'s progress: ${row.request.topic}`
            : `Rate: ${row.request.topic}`,
        subtitle: `Feedback round ${rating.loop} of 3`,
        dueAt: rating.dueAt.toISOString(),
        priority: state === 'overdue' ? 'high' : 'normal',
        actingAs: 'self',
        link: `/training/ratings/${rating.id}`,
        actionsPath: `/training/ratings/${rating.id}`,
        entityId: rating.id,
        createdAt: rating.createdAt.toISOString(),
        quickActions: [],
      });
    }

    // Booked participations starting soon without goals.
    const horizon = addDaysIso(today, this.config.get('GOALS_REMINDER_DAYS_BEFORE'));
    const noGoals = await this.prisma.trainingAttendee.findMany({
      where: {
        userId: user.id,
        status: 'booked',
        goal1: null,
        goal2: null,
        request: { startsOn: { gt: dateFromIso(today), lte: dateFromIso(horizon) } },
      },
      select: attendeeSelect,
    });
    for (const row of noGoals) {
      items.push({
        id: inboxItemId('training.goals_missing', row.id),
        module: 'training',
        type: 'training.goals_missing',
        reference: trainingReference(row.request.number),
        title: `Set goals: ${row.request.topic}`,
        subtitle: `Starts ${formatDate(isoFromDate(row.request.startsOn), today)}`,
        dueAt: due(row.request.startsOn),
        priority: 'normal',
        actingAs: 'self',
        link: `/training/participations/${row.id}#goals`,
        actionsPath: `/training/participations/${row.id}`,
        entityId: row.id,
        createdAt: row.updatedAt.toISOString(),
        quickActions: [],
      });
    }
    return items;
  }
}
