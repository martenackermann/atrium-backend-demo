import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { commentSchema, reasonSchema } from '@/common/domain/schemas';
import { Clock } from '@/common/time/clock.service';
import { isoDateInZone } from '@/common/time/time';
import { AppConfig } from '@/config/app-config';
import type { PrismaTx } from '@/database/prisma.types';
import type { Prisma } from '@/generated/prisma/client';
import { AttachmentService } from '@/modules/core/attachments/attachment.service';
import { lockRow } from '@/modules/core/workflow/workflow.actions';
import { defineWorkflow, type TransitionChange, type WorkflowDefinition } from '@/modules/core/workflow/workflow.types';
import { encryptPin } from '../domain/pin-cipher';
import { type BookBody, bookBodySchema } from '../dto/travel-request.dto';
import { TravelAccessService } from '../services/travel-access.service';
import { TravelNotifier } from '../services/travel-notifier.service';
import { travelDetailInclude, type TravelRow } from '../services/travel-row';
import { TRAVEL_BOOKING_ENTITY, travelReference } from '../travel.constants';
import { travelRequestMachine } from './travel-request.machine';

/** Minimal row shape the machine and permission checks need (list rows and detail rows both fit). */
export interface TravelStateRow {
  id: string;
  number: number;
  status: TravelRow['status'];
  travellerId: string;
  requesterId: string;
  approverId: string | null;
  startsAt: Date;
  endsAt: Date | null;
  statusBeforeCancellation: TravelRow['statusBeforeCancellation'];
  companions?: { userId: string }[];
  booking?: { pinEncrypted: string | null } | null;
}

const optionalComment = commentSchema.nullish().transform((v) => (v ? v : null));
const commentBody = z.strictObject({ comment: optionalComment });
const reasonBody = z.strictObject({ reason: reasonSchema });
const optionalReasonBody = z.strictObject({
  reason: z
    .string()
    .trim()
    .max(1000)
    .nullish()
    .transform((v) => (v ? v : null)),
});

/**
 * The travel_request workflow (SPEC §5.2): binds the machine to `travel_requests`, applies
 * the SPEC §3.2 permission matrix, persists decision/booking fields and sends notifications.
 */
@Injectable()
export class TravelWorkflow {
  readonly definition: WorkflowDefinition<typeof travelRequestMachine, TravelStateRow>;

  constructor(
    private readonly access: TravelAccessService,
    private readonly notifier: TravelNotifier,
    private readonly attachments: AttachmentService,
    private readonly clock: Clock,
    private readonly config: AppConfig,
  ) {
    const ownerOrRequester = ({ entity, actor }: { entity: TravelStateRow; actor: { id: string } }) =>
      entity.travellerId === actor.id
        ? ('self' as const)
        : entity.requesterId === actor.id
          ? ('requester' as const)
          : false;

    this.definition = defineWorkflow({
      name: 'travel_request',
      module: 'travel',
      entityType: 'travel_request',
      subjectType: 'TravelRequest',
      machine: travelRequestMachine,
      actions: {
        approve: {
          ability: false,
          input: commentBody,
          authorize: async ({ tx, entity, actor }) =>
            this.access.decideRight(await this.access.viewer(actor, tx), entity),
        },
        decline: {
          ability: false,
          input: reasonBody,
          authorize: async ({ tx, entity, actor }) =>
            this.access.decideRight(await this.access.viewer(actor, tx), entity),
        },
        withdraw: { ability: false, input: optionalReasonBody, authorize: ownerOrRequester },
        request_cancellation: { ability: false, input: reasonBody, authorize: ownerOrRequester },
        confirm_cancellation: { input: commentBody },
        reject_cancellation: { input: reasonBody },
        book: { input: bookBodySchema },
        mark_booking_impossible: { input: reasonBody },
        retry_booking: { input: commentBody },
        close: { input: reasonBody },
      },
      entityId: (row) => row.id,
      entityLabel: (row) => travelReference(row.number),
      toState: (row) => this.stateOf(row),
      load: async (tx, id, actor) => {
        if (!(await lockRow(tx, 'travel_requests', id))) return null;
        const row = await tx.travelRequest.findUnique({ where: { id }, include: travelDetailInclude });
        if (!row) return null;
        return this.access.canView(await this.access.viewer(actor, tx), row) ? row : null;
      },
      persist: (tx, row, next, change) => this.persist(tx, row, next.value as TravelRow['status'], change),
      afterTransition: ({ tx, entity, change, notifies }) =>
        this.notifier.afterTransition(tx, entity as TravelRow, change, notifies),
    });
  }

  /** Persisted state + time context for the guards. */
  stateOf(row: TravelStateRow) {
    const now = this.clock.now();
    const tz = this.clock.timeZone;
    return {
      value: row.status,
      context: {
        travellerId: row.travellerId,
        requesterId: row.requesterId,
        startsAtMs: row.startsAt.getTime(),
        startDay: isoDateInZone(row.startsAt, tz),
        lastDay: isoDateInZone(row.endsAt ?? row.startsAt, tz),
        nowMs: now.getTime(),
        today: isoDateInZone(now, tz),
        statusBeforeCancellation:
          row.statusBeforeCancellation === 'to_book' || row.statusBeforeCancellation === 'booked'
            ? row.statusBeforeCancellation
            : null,
      },
    };
  }

  private async persist(
    tx: PrismaTx,
    row: TravelStateRow,
    toState: TravelRow['status'],
    change: TransitionChange,
  ): Promise<TravelRow | null> {
    const now = this.clock.now();
    const input = (change.input ?? {}) as { comment?: string | null; reason?: string | null };
    const data: Prisma.TravelRequestUncheckedUpdateManyInput = { status: toState, version: { increment: 1 } };

    switch (change.action) {
      case 'approve':
        Object.assign(data, {
          approvedAt: now,
          approvedById: change.actor.id,
          approvalActingAs: change.actingAs,
          approvalComment: input.comment ?? null,
          approvalAutoApproval: null,
        });
        break;
      case 'decline':
        Object.assign(data, {
          declinedAt: now,
          declinedById: change.actor.id,
          declinedActingAs: change.actingAs,
          declineReason: input.reason,
        });
        break;
      case 'withdraw':
      case 'close':
        Object.assign(data, { cancelledAt: now, cancellationReason: input.reason ?? null });
        break;
      case 'request_cancellation':
        Object.assign(data, {
          statusBeforeCancellation: row.status,
          cancellationRequestedAt: now,
          cancellationReason: input.reason,
        });
        break;
      case 'confirm_cancellation':
        Object.assign(data, { cancelledAt: now });
        break;
      case 'reject_cancellation':
        Object.assign(data, {
          statusBeforeCancellation: null,
          cancellationRequestedAt: null,
          cancellationReason: null,
        });
        break;
      case 'mark_booking_impossible':
        Object.assign(data, { bookingImpossibleReason: input.reason });
        break;
      case 'retry_booking':
        Object.assign(data, { bookingImpossibleReason: null });
        break;
      case 'book':
        await this.book(tx, row, change, now);
        break;
      default:
        break;
    }

    const updated = await tx.travelRequest.updateMany({ where: { id: row.id, status: row.status }, data });
    if (updated.count === 0) return null;
    return tx.travelRequest.findUnique({ where: { id: row.id }, include: travelDetailInclude });
  }

  /** Creates the booking (PIN encrypted, D12) and links the confirmation PDFs. */
  private async book(tx: PrismaTx, row: TravelStateRow, change: TransitionChange, now: Date): Promise<void> {
    const body = change.input as BookBody;
    await this.attachments.link(tx, {
      ids: body.attachmentIds,
      entityType: TRAVEL_BOOKING_ENTITY,
      entityId: row.id,
      purposes: ['travel_booking_confirmation'],
      actor: change.actor,
    });
    const booking = {
      bookingNumber: body.bookingNumber,
      pinEncrypted: body.pin ? encryptPin(body.pin, this.config.get('ENCRYPTION_KEY')) : null,
      comment: body.comment ?? null,
      bookedById: change.actor.id,
      bookedAt: now,
    };
    await tx.travelBooking.upsert({
      where: { requestId: row.id },
      create: { requestId: row.id, ...booking },
      update: booking,
    });
  }
}
