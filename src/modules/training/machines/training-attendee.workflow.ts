import { Injectable } from '@nestjs/common';
import { hasRole } from '@/common/auth/auth-user';
import type { ActingAs } from '@/common/domain/vocabulary';
import { Clock } from '@/common/time/clock.service';
import { addDaysIso, isoFromDate, startOfDayInZone } from '@/common/time/time';
import { AppConfig } from '@/config/app-config';
import type { PrismaTx } from '@/database/prisma.types';
import type { Prisma } from '@/generated/prisma/client';
import { AttachmentService } from '@/modules/core/attachments/attachment.service';
import { AuditService } from '@/modules/core/audit/audit.service';
import { defaultActingAs } from '@/modules/core/workflow/workflow.service';
import { lockRow } from '@/modules/core/workflow/workflow.actions';
import { defineWorkflow, type ActionContext, type TransitionChange } from '@/modules/core/workflow/workflow.types';
import { ACTION_BODIES } from '../dto/training-request.dto';
import { TrainingAccess } from '../services/training-access.service';
import { TrainingNotifier } from '../services/training-notifier.service';
import { attendeeInclude, type AttendeeRow } from '../services/training.includes';
import { trainingAttendeeMachine } from './training-attendee.machine';

type Ctx = ActionContext<AttendeeRow>;

/**
 * Binds the attendee machine to `training_attendees` (D6): visibility-aware load with row
 * lock, permission hooks (approver / deputy / manager chain via the core approval rules,
 * owner, requester, back office), persistence of decision fields and the side effects
 * (rating rows, booking documents, extra audit rows, notifications).
 */
@Injectable()
export class TrainingAttendeeWorkflow {
  readonly def;

  constructor(
    private readonly access: TrainingAccess,
    private readonly clock: Clock,
    private readonly config: AppConfig,
    private readonly attachments: AttachmentService,
    private readonly audit: AuditService,
    private readonly notifier: TrainingNotifier,
  ) {
    const decide = (ctx: Ctx) => this.authorizeDecision(ctx);
    const withdraw = (ctx: Ctx) => this.authorizeWithdraw(ctx);
    const ownerOrRequester = ({ entity, actor }: Ctx): ActingAs | false =>
      entity.userId === actor.id ? 'self' : entity.request.requesterId === actor.id ? 'requester' : false;

    this.def = defineWorkflow({
      name: 'training_attendee',
      module: 'training',
      entityType: 'training_attendee',
      subjectType: 'TrainingAttendee',
      machine: trainingAttendeeMachine,
      actions: {
        approve: { ability: false, input: ACTION_BODIES.approve, authorize: decide },
        decline: { ability: false, input: ACTION_BODIES.decline, authorize: decide },
        withdraw: { ability: false, input: ACTION_BODIES.withdraw, authorize: withdraw },
        request_cancellation: { ability: false, input: ACTION_BODIES.request_cancellation, authorize: ownerOrRequester },
        confirm_cancellation: { input: ACTION_BODIES.confirm_cancellation },
        reject_cancellation: { input: ACTION_BODIES.reject_cancellation },
        book: { input: ACTION_BODIES.book },
        mark_booking_impossible: { input: ACTION_BODIES.mark_booking_impossible },
        retry_booking: { input: ACTION_BODIES.retry_booking },
        close: { input: ACTION_BODIES.close },
      },
      entityId: (row: AttendeeRow) => row.id,
      entityLabel: (row: AttendeeRow) => row.user.displayName,
      toState: (row: AttendeeRow) => ({
        value: row.status,
        context: {
          attendeeId: row.userId,
          requesterId: row.request.requesterId,
          executiveApproverId: row.executiveApproverId,
          startsOn: isoFromDate(row.request.startsOn),
          endsOn: isoFromDate(row.request.endsOn),
          today: this.clock.today(),
          statusBeforeCancellation: row.statusBeforeCancellation,
        },
      }),
      load: async (tx, id, actor) => {
        if (!(await lockRow(tx, 'training_attendees', id))) return null;
        const viewer = await this.access.viewer(actor, undefined, tx);
        return tx.trainingAttendee.findFirst({ where: { id, ...viewer.attendeeWhere() }, include: attendeeInclude });
      },
      persist: (tx, row, next, change) => this.persist(tx, row, next.value, change),
      afterTransition: async ({ tx, before, entity, change, notifies }) => {
        await this.afterTransition(tx, before, entity, change, notifies);
      },
    });
  }

  /** approve / decline: the current step's approver, their active deputy, or (manager step) the chain. */
  private async authorizeDecision({ entity, actor, ability }: Ctx): Promise<ActingAs | false> {
    const viewer = await this.access.viewer(actor, ability);
    if (entity.status === 'pending_manager_approval' && entity.approverId) {
      return viewer.canDecide({ kind: 'manager', approverId: entity.approverId, subjectId: entity.userId });
    }
    if (entity.status === 'pending_executive_approval' && entity.executiveApproverId) {
      return viewer.canDecide({ kind: 'executive', approverId: entity.executiveApproverId, subjectId: entity.userId });
    }
    return false;
  }

  /**
   * withdraw: attendee, requester or back office while pending (SPEC §3.1); attendee or requester
   * from booking_impossible (the back office uses `close` there, SPEC_RESOLUTIONS #11).
   */
  private authorizeWithdraw({ entity, actor }: Ctx): ActingAs | false {
    if (entity.userId === actor.id) return 'self';
    if (entity.request.requesterId === actor.id) return 'requester';
    const pending = entity.status === 'pending_manager_approval' || entity.status === 'pending_executive_approval';
    if (pending && hasRole(actor, 'training_office', 'it_admin')) return defaultActingAs(actor, 'training');
    return false;
  }

  private async persist(
    tx: PrismaTx,
    row: AttendeeRow,
    toState: string,
    change: TransitionChange,
  ): Promise<AttendeeRow | null> {
    const now = this.clock.now();
    const input = (change.input ?? {}) as Record<string, unknown>;
    const text = (key: string) => (typeof input[key] === 'string' && input[key] ? (input[key] as string) : null);
    const data: Prisma.TrainingAttendeeUncheckedUpdateManyInput = {
      status: toState as AttendeeRow['status'],
      version: { increment: 1 },
    };
    const managerStep = row.status === 'pending_manager_approval';

    switch (change.action) {
      case 'approve':
        if (managerStep) {
          Object.assign(data, {
            managerDecisionAt: now,
            managerDecisionById: change.actor.id,
            managerDecisionAs: change.actingAs,
            managerDecisionComment: text('comment'),
            managerAutoApproval: null,
          });
          if (toState === 'to_book' && row.executiveApproverId) {
            // D8: the executive step completes automatically (same approver, or the requester).
            Object.assign(data, {
              executiveDecisionAt: now,
              executiveDecisionById: row.executiveApproverId,
              executiveDecisionAs: 'system',
              executiveDecisionComment: null,
              executiveAutoApproval:
                row.executiveApproverId === change.actor.id ? 'same_approver' : 'requester_is_approver',
            });
          }
        } else {
          Object.assign(data, {
            executiveDecisionAt: now,
            executiveDecisionById: change.actor.id,
            executiveDecisionAs: change.actingAs,
            executiveDecisionComment: text('comment'),
            executiveAutoApproval: null,
          });
        }
        break;
      case 'decline':
        Object.assign(
          data,
          { declineReason: text('reason') },
          managerStep
            ? {
                managerDecisionAt: now,
                managerDecisionById: change.actor.id,
                managerDecisionAs: change.actingAs,
                managerDecisionComment: text('reason'),
              }
            : {
                executiveDecisionAt: now,
                executiveDecisionById: change.actor.id,
                executiveDecisionAs: change.actingAs,
                executiveDecisionComment: text('reason'),
              },
        );
        break;
      case 'withdraw':
      case 'close':
        Object.assign(data, { cancelledAt: now, cancellationReason: text('reason') });
        break;
      case 'request_cancellation':
        Object.assign(data, {
          statusBeforeCancellation: row.status,
          cancellationRequestedAt: now,
          cancellationReason: text('reason'),
        });
        break;
      case 'confirm_cancellation':
        Object.assign(data, { cancelledAt: now });
        break;
      case 'reject_cancellation':
        Object.assign(data, { statusBeforeCancellation: null, cancellationRequestedAt: null, cancellationReason: null });
        break;
      case 'book':
        Object.assign(data, { bookedAt: now, bookedById: change.actor.id, bookingReference: text('bookingReference') });
        break;
      case 'mark_booking_impossible':
        Object.assign(data, { bookingImpossibleReason: text('reason') });
        break;
      case 'retry_booking':
        Object.assign(data, { bookingImpossibleReason: null });
        break;
    }

    const result = await tx.trainingAttendee.updateMany({ where: { id: row.id, version: row.version }, data });
    if (result.count === 0) return null;
    return tx.trainingAttendee.findUniqueOrThrow({ where: { id: row.id }, include: attendeeInclude });
  }

  private async afterTransition(
    tx: PrismaTx,
    before: AttendeeRow,
    entity: AttendeeRow,
    change: TransitionChange,
    notifies: { kind: string }[],
  ): Promise<void> {
    const input = (change.input ?? {}) as Record<string, unknown>;
    let documentCount = 0;

    if (change.action === 'approve' && before.status === 'pending_manager_approval' && entity.executiveAutoApproval) {
      await this.audit.record(
        {
          module: 'training',
          entityType: 'training_attendee',
          entityId: entity.id,
          action: 'auto_approve',
          actorId: null,
          actingAs: 'system',
          fromState: 'pending_executive_approval',
          toState: 'to_book',
          reason: entity.executiveAutoApproval,
          metadata: { step: 'executive', autoApproval: entity.executiveAutoApproval },
          entityLabel: entity.user.displayName,
        },
        tx,
      );
    }

    if (change.action === 'book') {
      const ids = (input.attachmentIds as string[] | undefined) ?? [];
      await this.attachments.link(tx, {
        ids,
        entityType: 'training_attendee',
        entityId: entity.id,
        purposes: ['training_booking_document'],
        actor: change.actor,
      });
      documentCount = await tx.attachment.count({
        where: { entityType: 'training_attendee', entityId: entity.id, deletedAt: null },
      });
      await this.createLoop1Rating(tx, entity);
    }

    if (change.action === 'confirm_cancellation') {
      // SPEC §4.2: loop-1 rows of attendees who leave `booked` are deleted.
      await tx.trainingRating.deleteMany({ where: { attendeeId: entity.id, loop: 1, submittedAt: null } });
    }

    for (const { kind } of notifies) {
      await this.notifier.send(tx, entity, {
        kind,
        actorName: change.actor.displayName,
        actingAs: change.actingAs,
        reason: change.reason,
        comment: typeof input.comment === 'string' ? input.comment : null,
        documentCount,
        previousState: before.status,
      });
    }
  }

  /** Loop-1 row when the attendee becomes `booked`: due `endsOn + RATING_LOOP1_DELAY_DAYS` 00:00 local. */
  async createLoop1Rating(tx: PrismaTx, row: AttendeeRow): Promise<void> {
    const dueOn = addDaysIso(isoFromDate(row.request.endsOn), this.config.get('RATING_LOOP1_DELAY_DAYS'));
    const dueAt = startOfDayInZone(dueOn, this.clock.timeZone);
    await tx.trainingRating.upsert({
      where: { attendeeId_loop: { attendeeId: row.id, loop: 1 } },
      create: { attendeeId: row.id, loop: 1, raterId: row.userId, dueAt },
      update: {},
    });
  }
}
