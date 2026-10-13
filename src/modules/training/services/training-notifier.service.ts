import { Injectable } from '@nestjs/common';
import type { ActingAs, AutoApproval } from '@/common/domain/vocabulary';
import { Clock } from '@/common/time/clock.service';
import { addDaysIso, isoDateInZone, isoFromDate } from '@/common/time/time';
import { AppConfig } from '@/config/app-config';
import type { PrismaTx } from '@/database/prisma.types';
import { activeDeputiesOf } from '@/modules/core/approvals/approval-rules';
import { ApprovalService } from '@/modules/core/approvals/approval.service';
import { NotificationService, type Recipient } from '@/modules/core/notifications/notification.service';
import { approvalRequestedNotification } from '../mail/approval-requested.notification';
import { bookingImpossibleNotification } from '../mail/booking-impossible.notification';
import { bookingRequestedNotification } from '../mail/booking-requested.notification';
import { cancellationConfirmedNotification } from '../mail/cancellation-confirmed.notification';
import { cancellationRejectedNotification } from '../mail/cancellation-rejected.notification';
import { cancellationRequestedNotification } from '../mail/cancellation-requested.notification';
import { executiveApprovalRequestedNotification } from '../mail/executive-approval-requested.notification';
import { goalsReminderNotification } from '../mail/goals-reminder.notification';
import { participationApprovedNotification } from '../mail/participation-approved.notification';
import { participationBookedNotification } from '../mail/participation-booked.notification';
import { participationCreatedNotification } from '../mail/participation-created.notification';
import { participationDeclinedNotification } from '../mail/participation-declined.notification';
import { participationWithdrawnNotification } from '../mail/participation-withdrawn.notification';
import { ratingDueNotification } from '../mail/rating-due.notification';
import type { ParticipationContext } from '../mail/training-mail.helpers';
import { formatDate, formatDateRange, formatMoney, isHighPriority, trainingReference } from '../training.constants';
import type { AttendeeRow } from './training.includes';

const STATE_LABEL: Record<string, string> = {
  pending_manager_approval: 'Awaiting manager',
  pending_executive_approval: 'Awaiting executive',
  to_book: 'To book',
  booked: 'Booked',
  declined: 'Declined',
  booking_impossible: 'Booking impossible',
  cancellation_requested: 'Cancellation requested',
  cancelled: 'Cancelled',
  attended: 'Attended',
  not_attended: 'Did not attend',
};

const REASON_LABEL: Record<string, string> = {
  direct_manager: 'Direct manager',
  site_manager_escalation: 'Escalated past site manager',
  manager_unavailable: 'Manager unavailable',
  executive_self: 'Executive self-approval',
  fallback: 'Fallback approver',
};

const AUTO_LABEL: Record<AutoApproval, string> = {
  executive_self: 'Approved automatically (executive)',
  requester_is_approver: 'Approved automatically (requested by the approver)',
  same_approver: 'Approved automatically (same approver)',
};

const ACTING_LABEL: Partial<Record<ActingAs, string>> = {
  deputy: ' as deputy',
  manager_chain: ' as manager chain',
};

export function stateLabel(status: string): string {
  return STATE_LABEL[status] ?? status;
}

export function approverReasonLabel(reason: string): string {
  return REASON_LABEL[reason] ?? reason;
}

/** Event that triggers notifications: the transition (`kind` ids from the machine) or an entry. */
export interface NotifyEvent {
  kind: string;
  actorName?: string | null;
  actingAs?: ActingAs | null;
  reason?: string | null;
  comment?: string | null;
  /** Booking documents linked by `book`. */
  documentCount?: number;
  previousState?: string | null;
}

/**
 * Sends the training notifications of SPEC §7 inside the caller's transaction: recipients,
 * cc rules (deputies, requester), priorities and pre-formatted template contexts.
 */
@Injectable()
export class TrainingNotifier {
  constructor(
    private readonly notifications: NotificationService,
    private readonly approvals: ApprovalService,
    private readonly config: AppConfig,
    private readonly clock: Clock,
  ) {}

  base(row: AttendeeRow): ParticipationContext {
    const today = this.clock.today();
    return {
      attendeeId: row.id,
      attendee: row.user.displayName,
      topic: row.request.topic,
      reference: trainingReference(row.request.number),
      provider: row.request.provider,
      dates: formatDateRange(isoFromDate(row.request.startsOn), isoFromDate(row.request.endsOn), today),
    };
  }

  /** `startsOn ≤ today + days` and not in the past. */
  private startsWithin(row: AttendeeRow, days: number): boolean {
    const startsOn = isoFromDate(row.request.startsOn);
    const today = this.clock.today();
    return startsOn >= today && startsOn <= addDaysIso(today, days);
  }

  private highPriority(row: AttendeeRow): 'high' | 'normal' {
    return isHighPriority(
      row.status,
      isoFromDate(row.request.startsOn),
      this.clock.today(),
      this.config.get('TRAINING_HIGH_PRIORITY_DAYS'),
    )
      ? 'high'
      : 'normal';
  }

  private attendeeAndRequester(row: AttendeeRow): { to: Recipient[]; cc: Recipient[] } {
    return {
      to: [{ userId: row.userId }],
      cc: row.request.requesterId !== row.userId ? [{ userId: row.request.requesterId }] : [],
    };
  }

  private entity(row: AttendeeRow) {
    return { type: 'training_attendee', id: row.id };
  }

  /** Approver + their active deputies (cc) at send time (SPEC §6.2 last paragraph). */
  private async approverRecipients(tx: PrismaTx, approverId: string): Promise<{ to: Recipient[]; cc: Recipient[] }> {
    const org = await this.approvals.snapshot(tx);
    const deputies = activeDeputiesOf(org, approverId, this.clock.today());
    return { to: [{ userId: approverId }], cc: deputies.map((d) => ({ userId: d.id })) };
  }

  private approvalText(row: AttendeeRow): string {
    if (row.executiveDecisionAt) return this.decisionText(row, 'executive');
    if (row.managerDecisionAt) return this.decisionText(row, 'manager');
    return 'Approved';
  }

  private decisionText(row: AttendeeRow, step: 'manager' | 'executive'): string {
    const auto = step === 'manager' ? row.managerAutoApproval : row.executiveAutoApproval;
    if (auto) return AUTO_LABEL[auto];
    const by = step === 'manager' ? row.managerDecisionBy : row.executiveDecisionBy;
    const as = step === 'manager' ? row.managerDecisionAs : row.executiveDecisionAs;
    return `Approved by ${by?.displayName ?? 'the approver'}${as ? (ACTING_LABEL[as] ?? '') : ''}`;
  }

  /** Notifications on entry (create / add attendee), SPEC §5.1 "Side effects of entry". */
  async onEntry(tx: PrismaTx, row: AttendeeRow): Promise<void> {
    const base = this.base(row);
    const nextStep =
      row.status === 'pending_manager_approval'
        ? `${row.approver?.displayName ?? 'The approver'} decides next.`
        : row.status === 'pending_executive_approval'
          ? `${row.executiveApprover?.displayName ?? 'The executive approver'} decides next (executive approval).`
          : 'Approved automatically. The training office books it next.';
    await this.notifications.send(
      participationCreatedNotification,
      {
        ...this.attendeeAndRequester(row),
        context: {
          ...base,
          requester: row.request.requester.displayName,
          nextStep,
          approver: row.approver && row.approverId !== row.userId ? row.approver.displayName : null,
          approverReason: row.approverId !== row.userId ? approverReasonLabel(row.approverReason) : null,
        },
        entity: this.entity(row),
      },
      { tx },
    );
    if (row.status === 'pending_manager_approval') await this.send(tx, row, { kind: 'training.approval_requested' });
    else if (row.status === 'pending_executive_approval')
      await this.send(tx, row, { kind: 'training.executive_approval_requested' });
    else if (row.status === 'to_book') {
      // SPEC_RESOLUTIONS #28: auto-approved at creation -> approved notification + booking request.
      await this.send(tx, row, { kind: 'training.participation_approved' });
      await this.send(tx, row, { kind: 'training.booking_requested' });
    }
  }

  /** Sends one notification of SPEC §7 for the attendee row (already in its new state). */
  async send(tx: PrismaTx, row: AttendeeRow, event: NotifyEvent): Promise<void> {
    const base = this.base(row);
    const entity = this.entity(row);
    const cost = formatMoney(row.request.costCents);
    switch (event.kind) {
      case 'training.approval_requested': {
        if (!row.approverId) return;
        const escalated = row.escalatedFromId && row.approverReason === 'site_manager_escalation';
        const escalatedName = escalated ? await this.userName(tx, row.escalatedFromId!) : null;
        await this.notifications.send(
          approvalRequestedNotification,
          {
            ...(await this.approverRecipients(tx, row.approverId)),
            context: {
              ...base,
              approver: row.approver?.displayName ?? '',
              requester: row.request.requester.displayName,
              cost,
              escalationNote: escalatedName
                ? `Escalated to you because ${escalatedName} is a site manager.`
                : row.approverReason === 'manager_unavailable'
                  ? 'Sent to you because the direct manager is no longer active.'
                  : row.approverReason === 'fallback'
                    ? 'Sent to you as the fallback approver.'
                    : null,
              executiveNote: row.executiveApprover
                ? `Executive approval by ${row.executiveApprover.displayName} follows.`
                : null,
            },
            priority: this.highPriority(row),
            entity,
          },
          { tx },
        );
        return;
      }
      case 'training.executive_approval_requested': {
        if (!row.executiveApproverId) return;
        await this.notifications.send(
          executiveApprovalRequestedNotification,
          {
            ...(await this.approverRecipients(tx, row.executiveApproverId)),
            context: {
              ...base,
              cost,
              threshold: formatMoney(this.config.get('TRAINING_EXECUTIVE_THRESHOLD_CENTS')),
              managerDecision: `${this.decisionText(row, 'manager')}.`,
            },
            priority: this.highPriority(row),
            entity,
          },
          { tx },
        );
        return;
      }
      case 'training.participation_approved':
        await this.notifications.send(
          participationApprovedNotification,
          {
            ...this.attendeeAndRequester(row),
            context: {
              ...base,
              approvedBy: this.approvalText(row),
              comment: event.comment ?? row.executiveDecisionComment ?? row.managerDecisionComment ?? null,
            },
            entity,
          },
          { tx },
        );
        return;
      case 'training.participation_declined':
        await this.notifications.send(
          participationDeclinedNotification,
          {
            ...this.attendeeAndRequester(row),
            context: { ...base, decider: event.actorName ?? 'The approver', reason: row.declineReason ?? '' },
            entity,
          },
          { tx },
        );
        return;
      case 'training.participation_withdrawn': {
        const pendingApprover =
          event.previousState === 'pending_executive_approval' ? row.executiveApproverId : row.approverId;
        if (!pendingApprover) return;
        const cc: Recipient[] = [{ userId: row.userId }];
        if (row.request.requesterId !== row.userId) cc.push({ userId: row.request.requesterId });
        await this.notifications.send(
          participationWithdrawnNotification,
          {
            to: [{ userId: pendingApprover }],
            cc,
            context: { ...base, withdrawnBy: event.actorName ?? row.user.displayName, reason: event.reason ?? null },
            entity,
          },
          { tx },
        );
        return;
      }
      case 'training.booking_requested': {
        const hotel =
          row.hotelNeeded && row.hotelCheckInOn && row.hotelCheckOutOn
            ? `${formatDateRange(isoFromDate(row.hotelCheckInOn), isoFromDate(row.hotelCheckOutOn), this.clock.today())}${
                row.hotelCostCents !== null ? ` · ${formatMoney(row.hotelCostCents)}` : ''
              }`
            : null;
        await this.notifications.send(
          bookingRequestedNotification,
          {
            to: [{ mailbox: 'training_office' }],
            context: {
              ...base,
              requester: row.request.requester.displayName,
              registrationUrl: row.request.registrationUrl,
              registrationDetails: row.request.registrationDetails,
              hotel,
              approval: this.approvalText(row),
            },
            priority: this.highPriority(row),
            entity,
          },
          { tx },
        );
        return;
      }
      case 'training.participation_booked':
        await this.notifications.send(
          participationBookedNotification,
          {
            ...this.attendeeAndRequester(row),
            context: {
              ...base,
              bookingReference: row.bookingReference,
              comment: event.comment ?? null,
              documentCount: event.documentCount ?? 0,
            },
            entity,
          },
          { tx },
        );
        return;
      case 'training.booking_impossible':
        await this.notifications.send(
          bookingImpossibleNotification,
          {
            ...this.attendeeAndRequester(row),
            context: { ...base, reason: row.bookingImpossibleReason ?? event.reason ?? '' },
            entity,
          },
          { tx },
        );
        return;
      case 'training.cancellation_requested':
        await this.notifications.send(
          cancellationRequestedNotification,
          {
            to: [{ mailbox: 'training_office' }],
            cc: [{ userId: row.userId }],
            context: {
              ...base,
              requestedBy: event.actorName ?? row.user.displayName,
              reason: row.cancellationReason ?? event.reason ?? '',
              previousState: stateLabel(row.statusBeforeCancellation ?? 'booked'),
            },
            priority: this.startsWithin(row, 3) ? 'high' : 'normal',
            entity,
          },
          { tx },
        );
        return;
      case 'training.cancellation_confirmed':
        await this.notifications.send(
          cancellationConfirmedNotification,
          {
            ...this.attendeeAndRequester(row),
            context: { ...base, comment: event.comment ?? event.reason ?? null },
            entity,
          },
          { tx },
        );
        return;
      case 'training.cancellation_rejected':
        await this.notifications.send(
          cancellationRejectedNotification,
          {
            ...this.attendeeAndRequester(row),
            context: { ...base, reason: event.reason ?? '', state: stateLabel(row.status) },
            entity,
          },
          { tx },
        );
        return;
      default:
        throw new Error(`Unknown training notification ${event.kind}`);
    }
  }

  async goalsReminder(tx: PrismaTx, row: AttendeeRow): Promise<void> {
    await this.notifications.send(
      goalsReminderNotification,
      { to: [{ userId: row.userId }], context: this.base(row), entity: this.entity(row) },
      { tx },
    );
  }

  async ratingDue(
    tx: PrismaTx,
    row: AttendeeRow,
    rating: { id: string; loop: number; raterId: string; dueAt: Date; reminderCount: number },
  ): Promise<void> {
    const today = this.clock.today();
    await this.notifications.send(
      ratingDueNotification,
      {
        to: [{ userId: rating.raterId }],
        context: {
          ...this.base(row),
          ratingId: rating.id,
          loop: rating.loop,
          dueDate: formatDate(isoDateInZone(rating.dueAt, this.clock.timeZone), today),
          reminder: rating.reminderCount,
          reminderMax: this.config.get('RATING_REMINDER_MAX'),
        },
        priority: rating.reminderCount >= 3 ? 'high' : 'normal',
        entity: { type: 'training_rating', id: rating.id },
      },
      { tx },
    );
  }

  private async userName(tx: PrismaTx, id: string): Promise<string | null> {
    const user = await tx.user.findUnique({ where: { id }, select: { displayName: true } });
    return user?.displayName ?? null;
  }
}
