import { Injectable } from '@nestjs/common';
import { money, toRef, toUserRef, toUserRefOrNull } from '@/common/domain/mappers';
import type { ActingAs } from '@/common/domain/vocabulary';
import { Clock } from '@/common/time/clock.service';
import { isoFromDate } from '@/common/time/time';
import { AppConfig } from '@/config/app-config';
import { PrismaService } from '@/database/prisma.service';
import type { PrismaTx } from '@/database/prisma.types';
import type { User } from '@/generated/prisma/client';
import type { AttachmentView } from '@/modules/core/attachments/attachment.service';
import { AttachmentService } from '@/modules/core/attachments/attachment.service';
import type {
  ParticipationListItemView,
  TrainingAttendeeView,
  TrainingRatingView,
  TrainingRequestSummaryView,
} from '../dto/training-response.schemas';
import {
  type AttendeeAction,
  type AttendeeStatus,
  isHighPriority,
  ratingState,
  trainingReference,
} from '../training.constants';
import type { TrainingViewer } from './training-access.service';
import type { AttendeeRow, RatingRow, RequestCoreRow } from './training.includes';

type Decision = TrainingAttendeeView['managerDecision'];

/** Prisma rows -> API DTOs (API.md §4.2). Every field present; empty = null / []. */
@Injectable()
export class TrainingMapper {
  constructor(
    private readonly config: AppConfig,
    private readonly clock: Clock,
    private readonly attachments: AttachmentService,
    private readonly prisma: PrismaService,
  ) {}

  get threshold(): number {
    return this.config.get('TRAINING_EXECUTIVE_THRESHOLD_CENTS');
  }

  executiveStepRequired(costCents: number): boolean {
    return costCents >= this.threshold;
  }

  highPriority(status: string, startsOn: Date): boolean {
    return isHighPriority(
      status,
      isoFromDate(startsOn),
      this.clock.today(),
      this.config.get('TRAINING_HIGH_PRIORITY_DAYS'),
    );
  }

  requestSummary(row: RequestCoreRow, viewer: TrainingViewer): TrainingRequestSummaryView {
    const statusCounts: Partial<Record<AttendeeStatus, number>> = {};
    for (const a of row.attendees) statusCounts[a.status] = (statusCounts[a.status] ?? 0) + 1;
    return {
      id: row.id,
      reference: trainingReference(row.number),
      topic: row.topic,
      provider: row.provider,
      format: row.format,
      location: row.location,
      startsOn: isoFromDate(row.startsOn),
      endsOn: isoFromDate(row.endsOn),
      cost: money(row.costCents),
      requester: toUserRef(row.requester),
      attendeeCount: row.attendees.length,
      statusCounts,
      billingStatus: row.billingStatus,
      actualCost: viewer.isBackOffice && row.actualCostCents !== null ? money(row.actualCostCents) : null,
      executiveStepRequired: this.executiveStepRequired(row.costCents),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private decision(
    at: Date | null,
    by: User | null,
    as: ActingAs | null,
    auto: TrainingAttendeeView['approverReason'] | string | null,
    comment: string | null,
  ): Decision {
    if (!at) return null;
    return {
      at: at.toISOString(),
      by: toUserRefOrNull(by),
      actingAs: as ?? 'system',
      autoApproval: (auto as NonNullable<Decision>['autoApproval']) ?? null,
      comment,
    };
  }

  ratingBriefs(row: AttendeeRow): TrainingAttendeeView['ratings'] {
    const now = this.clock.now();
    const overdue = this.config.get('RATING_OVERDUE_DAYS');
    return row.ratings.map((r) => ({
      id: r.id,
      loop: r.loop as 1 | 2 | 3,
      state: ratingState(r, now, overdue),
      dueAt: r.dueAt.toISOString(),
      submittedAt: r.submittedAt?.toISOString() ?? null,
      rater: toUserRef(r.rater),
    }));
  }

  attendee(row: AttendeeRow, availableActions: AttendeeAction[], attachments: AttachmentView[]): TrainingAttendeeView {
    return {
      id: row.id,
      requestId: row.requestId,
      user: toUserRef(row.user),
      costCenter: toRef(row.costCenter),
      status: row.status,
      approver: toUserRefOrNull(row.approver),
      approverReason: row.approverReason,
      escalatedFrom: toUserRefOrNull(row.escalatedFrom),
      executiveApprover: toUserRefOrNull(row.executiveApprover),
      hotel:
        row.hotelNeeded && row.hotelCheckInOn && row.hotelCheckOutOn
          ? {
              checkInOn: isoFromDate(row.hotelCheckInOn),
              checkOutOn: isoFromDate(row.hotelCheckOutOn),
              cost: row.hotelCostCents !== null ? money(row.hotelCostCents) : null,
            }
          : null,
      goals: { goal1: row.goal1, goal2: row.goal2, updatedAt: row.goalsUpdatedAt?.toISOString() ?? null },
      bookingReference: row.bookingReference,
      managerDecision: this.decision(
        row.managerDecisionAt,
        row.managerDecisionBy,
        row.managerDecisionAs,
        row.managerAutoApproval,
        row.managerDecisionComment,
      ),
      executiveDecision: this.decision(
        row.executiveDecisionAt,
        row.executiveDecisionBy,
        row.executiveDecisionAs,
        row.executiveAutoApproval,
        row.executiveDecisionComment,
      ),
      declineReason: row.declineReason,
      bookingImpossibleReason: row.bookingImpossibleReason,
      cancellationReason: row.cancellationReason,
      bookedAt: row.bookedAt?.toISOString() ?? null,
      cancellationRequestedAt: row.cancellationRequestedAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      attachments,
      ratings: this.ratingBriefs(row),
      isHighPriority: this.highPriority(row.status, row.request.startsOn),
      availableActions,
      updatedAt: row.updatedAt.toISOString(),
      version: row.version,
    };
  }

  listItem(
    row: AttendeeRow,
    actingAs: ActingAs | null,
    availableActions: AttendeeAction[],
    viewer: TrainingViewer,
  ): ParticipationListItemView {
    const now = this.clock.now();
    const overdue = this.config.get('RATING_OVERDUE_DAYS');
    const open = row.ratings.find((r) => !r.submittedAt && r.raterId === viewer.id);
    return {
      id: row.id,
      status: row.status,
      user: toUserRef(row.user),
      approver: toUserRefOrNull(row.approver),
      approverReason: row.approverReason,
      escalatedFrom: toUserRefOrNull(row.escalatedFrom),
      executiveApprover: toUserRefOrNull(row.executiveApprover),
      actingAs,
      request: {
        id: row.request.id,
        reference: trainingReference(row.request.number),
        topic: row.request.topic,
        provider: row.request.provider,
        format: row.request.format,
        startsOn: isoFromDate(row.request.startsOn),
        endsOn: isoFromDate(row.request.endsOn),
        cost: money(row.request.costCents),
        executiveStepRequired: this.executiveStepRequired(row.request.costCents),
        requester: toUserRef(row.request.requester),
      },
      hotelNeeded: row.hotelNeeded,
      isHighPriority: this.highPriority(row.status, row.request.startsOn),
      goalsSet: Boolean(row.goal1 || row.goal2),
      openRating: open
        ? {
            id: open.id,
            loop: open.loop as 1 | 2 | 3,
            state: ratingState(open, now, overdue),
            dueAt: open.dueAt.toISOString(),
          }
        : null,
      updatedAt: row.updatedAt.toISOString(),
      availableActions,
    };
  }

  rating(row: RatingRow, viewer: TrainingViewer): TrainingRatingView {
    const now = this.clock.now();
    const state = ratingState(row, now, this.config.get('RATING_OVERDUE_DAYS'));
    // Loop-3 answers are never shown to the attendee (they cannot open the row at all).
    const answersVisible = row.submittedAt !== null;
    const attendeeStatus = row.attendee.status;
    const rightState = row.loop === 1 ? attendeeStatus === 'booked' : attendeeStatus === 'attended';
    const canSubmit = row.raterId === viewer.id && (state === 'due' || state === 'overdue') && rightState;
    return {
      id: row.id,
      loop: row.loop as 1 | 2 | 3,
      state,
      rater: toUserRef(row.rater),
      attendee: { id: row.attendee.id, user: toUserRef(row.attendee.user) },
      training: {
        requestId: row.attendee.request.id,
        reference: trainingReference(row.attendee.request.number),
        topic: row.attendee.request.topic,
        provider: row.attendee.request.provider,
        startsOn: isoFromDate(row.attendee.request.startsOn),
        endsOn: isoFromDate(row.attendee.request.endsOn),
      },
      dueAt: row.dueAt.toISOString(),
      submittedAt: row.submittedAt?.toISOString() ?? null,
      reminderCount: row.reminderCount,
      lastRemindedAt: row.lastRemindedAt?.toISOString() ?? null,
      answers: answersVisible ? this.answers(row) : null,
      availableActions: canSubmit ? ['submit'] : [],
    };
  }

  private answers(row: RatingRow): TrainingRatingView['answers'] {
    if (row.loop === 1) {
      return {
        loop: 1,
        participated: row.participated ?? false,
        overallGrade: row.overallGrade,
        trainerGrade: row.trainerGrade,
        expectationsGrade: row.expectationsGrade,
        comment: row.comment,
      };
    }
    if (row.loop === 2) {
      return {
        loop: 2,
        appliesLearned: row.appliesLearned ?? 'D',
        supervisorSupported: row.supervisorSupported ?? 'D',
        worthwhileForOrganization: row.worthwhileForOrganization ?? 'D',
        comment: row.comment,
      };
    }
    return {
      loop: 3,
      improvementObserved: row.improvementObserved ?? 4,
      certificationGained: row.certificationGained ?? false,
      certificationComment: row.certificationComment,
      comment: row.comment,
    };
  }

  /** Booking documents of many attendees in one query. */
  async bookingDocuments(attendeeIds: string[], db: PrismaTx = this.prisma): Promise<Map<string, AttachmentView[]>> {
    const map = new Map<string, AttachmentView[]>();
    if (attendeeIds.length === 0) return map;
    const rows = await db.attachment.findMany({
      where: { entityType: 'training_attendee', entityId: { in: attendeeIds }, deletedAt: null },
      include: { uploadedBy: true },
      orderBy: { createdAt: 'asc' },
    });
    for (const row of rows) {
      const list = map.get(row.entityId!) ?? [];
      list.push(this.attachments.toView(row));
      map.set(row.entityId!, list);
    }
    return map;
  }
}
