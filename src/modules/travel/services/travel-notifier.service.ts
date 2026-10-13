import { Injectable } from '@nestjs/common';
import { Clock } from '@/common/time/clock.service';
import { AppConfig } from '@/config/app-config';
import type { PrismaTx } from '@/database/prisma.types';
import { ApprovalService } from '@/modules/core/approvals/approval.service';
import { NotificationService, type Recipient } from '@/modules/core/notifications/notification.service';
import type { NotifyParams, TransitionChange } from '@/modules/core/workflow/workflow.types';
import { formatTripWhen } from '../domain/travel-format';
import { isHighPriority } from '../domain/travel-rules';
import { travelApprovalRequested } from '../mail/travel.approval_requested.notification';
import { travelApproved } from '../mail/travel.approved.notification';
import { travelBooked } from '../mail/travel.booked.notification';
import { travelBookingImpossible } from '../mail/travel.booking_impossible.notification';
import { travelCancellationRejected } from '../mail/travel.cancellation_rejected.notification';
import { travelCancellationRequested } from '../mail/travel.cancellation_requested.notification';
import { travelCancelled } from '../mail/travel.cancelled.notification';
import { travelCreatedForYou } from '../mail/travel.created_for_you.notification';
import { travelDeclined } from '../mail/travel.declined.notification';
import { travelSubmittedToDesk } from '../mail/travel.submitted_to_desk.notification';
import { travelWithdrawn } from '../mail/travel.withdrawn.notification';
import type { TravelMailBase } from '../mail/travel-mail.helpers';
import { APPROVAL_EXEMPTION_LABELS, APPROVAL_REASON_LABELS, TRAVEL_ENTITY, travelReference } from '../travel.constants';
import { TRAVEL_ENUMS } from '../travel.enums';
import type { TravelRow } from './travel-row';

const DAY_MS = 86_400_000;

const statusLabel = (status: string): string =>
  TRAVEL_ENUMS.travelStatus.find((o) => o.value === status)?.label ?? status;

/**
 * Sends the travel notifications of SPEC §7 inside the caller's transaction (creation,
 * transitions). Recipients: users get email + in-app (D17), the desk mailbox email only.
 */
@Injectable()
export class TravelNotifier {
  constructor(
    private readonly notifications: NotificationService,
    private readonly approvals: ApprovalService,
    private readonly clock: Clock,
    private readonly config: AppConfig,
  ) {}

  base(row: TravelRow): TravelMailBase {
    return {
      requestId: row.id,
      reference: travelReference(row.number),
      kind: row.kind,
      route: row.routeSummary,
      traveller: row.traveller.displayName,
      when: formatTripWhen(row.startsAt, row.endsAt, this.clock.timeZone),
    };
  }

  private priority(row: TravelRow): 'high' | 'normal' {
    return isHighPriority(row.status, row.startsAt, this.clock.now(), this.config.get('TRAVEL_HIGH_PRIORITY_DAYS'))
      ? 'high'
      : 'normal';
  }

  private entity(row: TravelRow) {
    return { type: TRAVEL_ENTITY, id: row.id };
  }

  /** Traveller first, then the requester when different. */
  private travellerAndRequester(row: TravelRow): { to: Recipient[]; cc: Recipient[] } {
    return {
      to: [{ userId: row.travellerId }],
      cc: row.requesterId !== row.travellerId ? [{ userId: row.requesterId }] : [],
    };
  }

  /** Entry notifications after creation (SPEC §5.2 entry table). */
  async afterCreate(tx: PrismaTx, row: TravelRow): Promise<void> {
    const base = this.base(row);
    if (row.requesterId !== row.travellerId) {
      await this.notifications.send(
        travelCreatedForYou,
        {
          to: [{ userId: row.travellerId }],
          context: { ...base, requester: row.requester.displayName },
          entity: this.entity(row),
        },
        { tx },
      );
    }
    if (row.status === 'pending_approval') {
      await this.approvalRequested(tx, row);
    } else if (row.approvalAutoApproval === 'requester_is_approver') {
      await this.approved(tx, row, {
        automatic: true,
        comment: null,
        approver: row.approver?.displayName ?? row.requester.displayName,
      });
    } else {
      await this.notifications.send(
        travelSubmittedToDesk,
        {
          to: [{ mailbox: 'travel_desk' }],
          cc: [{ userId: row.travellerId }],
          context: {
            ...base,
            requester: row.requester.displayName,
            exemption: row.approvalExemption ? APPROVAL_EXEMPTION_LABELS[row.approvalExemption] : null,
          },
          priority: this.priority(row),
          entity: this.entity(row),
        },
        { tx },
      );
    }
  }

  private async approvalRequested(tx: PrismaTx, row: TravelRow): Promise<void> {
    if (!row.approverId || !row.approver) return;
    const deputies = await this.approvals.activeDeputiesOf(row.approverId, tx);
    await this.notifications.send(
      travelApprovalRequested,
      {
        to: [{ userId: row.approverId }],
        cc: deputies.filter((d) => d.id !== row.travellerId).map((d) => ({ userId: d.id })),
        context: {
          ...this.base(row),
          reasons: row.approvalReasons.map((code) => APPROVAL_REASON_LABELS[code]),
          approver: row.approver.displayName,
          requester: row.requester.displayName,
          escalatedFrom: row.escalatedFrom?.displayName ?? null,
        },
        priority: this.priority(row),
        entity: this.entity(row),
      },
      { tx },
    );
  }

  private async approved(
    tx: PrismaTx,
    row: TravelRow,
    input: { automatic: boolean; comment: string | null; approver: string },
  ): Promise<void> {
    const people = this.travellerAndRequester(row);
    await this.notifications.send(
      travelApproved,
      {
        to: [{ mailbox: 'travel_desk' }],
        cc: [...people.to, ...people.cc],
        context: { ...this.base(row), approver: input.approver, comment: input.comment, automatic: input.automatic },
        priority: this.priority(row),
        entity: this.entity(row),
      },
      { tx },
    );
  }

  /** `notify` actions executed by the machine during a transition. */
  async afterTransition(
    tx: PrismaTx,
    row: TravelRow,
    change: TransitionChange,
    notifies: NotifyParams[],
  ): Promise<void> {
    const input = (change.input ?? {}) as { comment?: string | null; reason?: string | null };
    const base = this.base(row);
    const people = this.travellerAndRequester(row);
    for (const { kind } of notifies) {
      switch (kind) {
        case 'travel.approved':
          await this.approved(tx, row, {
            automatic: false,
            comment: input.comment ?? null,
            approver: change.actor.displayName,
          });
          break;
        case 'travel.declined':
          await this.notifications.send(
            travelDeclined,
            {
              ...people,
              context: { ...base, decider: change.actor.displayName, reason: input.reason ?? '' },
              entity: this.entity(row),
            },
            { tx },
          );
          break;
        case 'travel.withdrawn':
          if (row.approverId) {
            await this.notifications.send(
              travelWithdrawn,
              {
                to: [{ userId: row.approverId }],
                context: { ...base, actor: change.actor.displayName, reason: input.reason ?? null },
                entity: this.entity(row),
              },
              { tx },
            );
          }
          break;
        case 'travel.booked': {
          const attachmentIds = (change.input as { attachmentIds?: string[] }).attachmentIds ?? [];
          await this.notifications.send(
            travelBooked,
            {
              to: people.to,
              cc: [...people.cc, ...row.companions.map((c) => ({ userId: c.userId }))],
              context: {
                ...base,
                bookingNumber: row.booking?.bookingNumber ?? '',
                hasPin: !!row.booking?.pinEncrypted,
                comment: row.booking?.comment ?? null,
                attachmentCount: attachmentIds.length,
              },
              entity: this.entity(row),
              attachmentIds,
            },
            { tx },
          );
          break;
        }
        case 'travel.booking_impossible':
          await this.notifications.send(
            travelBookingImpossible,
            { ...people, context: { ...base, reason: input.reason ?? '' }, entity: this.entity(row) },
            { tx },
          );
          break;
        case 'travel.cancellation_requested': {
          const soon = row.startsAt.getTime() <= this.clock.now().getTime() + 3 * DAY_MS;
          await this.notifications.send(
            travelCancellationRequested,
            {
              to: [{ mailbox: 'travel_desk' }],
              cc: [{ userId: row.travellerId }],
              context: {
                ...base,
                actor: change.actor.displayName,
                reason: input.reason ?? '',
                previousState: statusLabel(change.fromState),
              },
              priority: soon ? 'high' : 'normal',
              entity: this.entity(row),
            },
            { tx },
          );
          break;
        }
        case 'travel.cancelled':
          await this.notifications.send(
            travelCancelled,
            {
              ...people,
              context: { ...base, comment: input.comment ?? input.reason ?? null },
              entity: this.entity(row),
            },
            { tx },
          );
          break;
        case 'travel.cancellation_rejected':
          await this.notifications.send(
            travelCancellationRejected,
            {
              ...people,
              context: { ...base, reason: input.reason ?? '', restoredState: statusLabel(change.toState) },
              entity: this.entity(row),
            },
            { tx },
          );
          break;
        default:
          break;
      }
    }
  }
}
