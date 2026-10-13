import { and, setup } from 'xstate';
import type { IsoDate } from '@/common/time/time';
import { workflowActions } from '@/modules/core/workflow/workflow.actions';
import type { WorkflowEvent } from '@/modules/core/workflow/workflow.types';
import type { WorkflowMeta } from '@/modules/core/meta/workflow.registry';

/**
 * Training attendee lifecycle (SPEC §5.1 + SPEC_RESOLUTIONS #11). Pure definition: the
 * service builds a snapshot from the persisted `status`; nothing is persisted as an actor.
 * Guards only read the context and the acting user (never the body), so
 * `availableActions` can be computed without input.
 */
export interface AttendeeMachineContext {
  /** The attendee's user id (subject of the approval). */
  attendeeId: string;
  requesterId: string;
  executiveApproverId: string | null;
  startsOn: IsoDate;
  endsOn: IsoDate;
  /** "Today" in APP_TIMEZONE when the snapshot was built. */
  today: IsoDate;
  statusBeforeCancellation: string | null;
}

type Comment = { comment?: string | null };
type Reason = { reason: string };

export type AttendeeMachineEvent =
  | WorkflowEvent<'approve', Comment>
  | WorkflowEvent<'decline', Reason>
  | WorkflowEvent<'withdraw', { reason?: string | null }>
  | WorkflowEvent<'request_cancellation', Reason>
  | WorkflowEvent<'confirm_cancellation', Comment>
  | WorkflowEvent<'reject_cancellation', Reason>
  | WorkflowEvent<'book', { bookingReference?: string | null; comment?: string | null; attachmentIds?: string[] }>
  | WorkflowEvent<'mark_booking_impossible', Reason>
  | WorkflowEvent<'retry_booking', Comment>
  | WorkflowEvent<'close', Reason>
  | WorkflowEvent<'submit_rating_1', { participated: boolean }>;

const notify = (kind: string) => ({ type: 'notify' as const, params: { kind } });

export const trainingAttendeeMachine = setup({
  types: { context: {} as AttendeeMachineContext, events: {} as AttendeeMachineEvent },
  guards: {
    /** Nobody decides their own step (SPEC §6.2). */
    notSubject: ({ context, event }) => event.actor.id !== context.attendeeId,
    /** Approval only for trainings that have not started yet (SPEC_RESOLUTIONS #11). */
    notStarted: ({ context }) => context.startsOn >= context.today,
    /**
     * The executive step still needs a separate decision: required, and the executive is
     * neither the actor (same_approver) nor the requester (requester_is_approver).
     */
    executiveStepFollows: ({ context, event }) =>
      context.executiveApproverId !== null &&
      context.executiveApproverId !== event.actor.id &&
      context.executiveApproverId !== context.requesterId,
    /** Cancellation is possible until the training has ended (`endsOn >= today`). */
    notEnded: ({ context }) => context.endsOn >= context.today,
    wasBooked: ({ context }) => context.statusBeforeCancellation === 'booked',
    participated: ({ event }) => event.type === 'submit_rating_1' && event.input?.participated === true,
  },
  actions: { ...workflowActions },
}).createMachine({
  id: 'trainingAttendee',
  initial: 'pending_manager_approval',
  context: {
    attendeeId: '',
    requesterId: '',
    executiveApproverId: null,
    startsOn: '1970-01-01',
    endsOn: '1970-01-01',
    today: '1970-01-01',
    statusBeforeCancellation: null,
  },
  states: {
    pending_manager_approval: {
      on: {
        approve: [
          {
            guard: and(['notSubject', 'notStarted', 'executiveStepFollows']),
            target: 'pending_executive_approval',
            actions: [notify('training.executive_approval_requested')],
          },
          {
            guard: and(['notSubject', 'notStarted']),
            target: 'to_book',
            actions: [notify('training.participation_approved'), notify('training.booking_requested')],
          },
        ],
        decline: { guard: 'notSubject', target: 'declined', actions: [notify('training.participation_declined')] },
        withdraw: { target: 'cancelled', actions: [notify('training.participation_withdrawn')] },
      },
    },
    pending_executive_approval: {
      on: {
        approve: {
          guard: and(['notSubject', 'notStarted']),
          target: 'to_book',
          actions: [notify('training.participation_approved'), notify('training.booking_requested')],
        },
        decline: { guard: 'notSubject', target: 'declined', actions: [notify('training.participation_declined')] },
        withdraw: { target: 'cancelled', actions: [notify('training.participation_withdrawn')] },
      },
    },
    to_book: {
      on: {
        request_cancellation: {
          guard: 'notEnded',
          target: 'cancellation_requested',
          actions: [notify('training.cancellation_requested')],
        },
        book: { target: 'booked', actions: [notify('training.participation_booked')] },
        mark_booking_impossible: { target: 'booking_impossible', actions: [notify('training.booking_impossible')] },
      },
    },
    booked: {
      on: {
        request_cancellation: {
          guard: 'notEnded',
          target: 'cancellation_requested',
          actions: [notify('training.cancellation_requested')],
        },
        // Applied by the ratings endpoint (loop 1), not via /actions.
        submit_rating_1: [{ guard: 'participated', target: 'attended' }, { target: 'not_attended' }],
      },
    },
    booking_impossible: {
      on: {
        withdraw: { target: 'cancelled' },
        retry_booking: { guard: 'notStarted', target: 'to_book' },
        close: { target: 'cancelled', actions: [notify('training.cancellation_confirmed')] },
      },
    },
    cancellation_requested: {
      on: {
        confirm_cancellation: { target: 'cancelled', actions: [notify('training.cancellation_confirmed')] },
        reject_cancellation: [
          { guard: 'wasBooked', target: 'booked', actions: [notify('training.cancellation_rejected')] },
          { target: 'to_book', actions: [notify('training.cancellation_rejected')] },
        ],
      },
    },
    declined: { type: 'final' },
    cancelled: { type: 'final' },
    attended: { type: 'final' },
    not_attended: { type: 'final' },
  },
});

/** Diagram metadata for `GET /meta/workflows/training_attendee` (tones: DESIGN.md §2.4). */
export const trainingAttendeeWorkflowMeta: WorkflowMeta = {
  name: 'training_attendee',
  label: 'Training participation',
  machine: trainingAttendeeMachine,
  initialStates: ['pending_manager_approval', 'pending_executive_approval', 'to_book'],
  states: {
    pending_manager_approval: { label: 'Awaiting manager', tone: 'waiting' },
    pending_executive_approval: { label: 'Awaiting executive', tone: 'waiting' },
    to_book: { label: 'To book', tone: 'moving' },
    booked: { label: 'Booked', tone: 'positive' },
    booking_impossible: { label: 'Booking impossible', tone: 'blocked' },
    cancellation_requested: { label: 'Cancellation requested', tone: 'waiting' },
    attended: { label: 'Attended', tone: 'positive' },
    not_attended: { label: 'Did not attend', tone: 'neutral' },
    declined: { label: 'Declined', tone: 'negative' },
    cancelled: { label: 'Cancelled', tone: 'neutral' },
  },
  events: {
    approve: { label: 'Approve', actors: ['Approver', 'Executive', 'Deputy', 'Manager chain'] },
    decline: { label: 'Decline', actors: ['Approver', 'Executive', 'Deputy', 'Manager chain'] },
    withdraw: { label: 'Withdraw', actors: ['Attendee', 'Requester', 'Training office'] },
    request_cancellation: { label: 'Request cancellation', actors: ['Attendee', 'Requester'] },
    confirm_cancellation: { label: 'Confirm cancellation', actors: ['Training office'] },
    reject_cancellation: { label: 'Reject cancellation', actors: ['Training office'] },
    book: { label: 'Book', actors: ['Training office'] },
    mark_booking_impossible: { label: 'Mark booking impossible', actors: ['Training office'] },
    retry_booking: { label: 'Retry booking', actors: ['Training office'] },
    close: { label: 'Close', actors: ['Training office'] },
    submit_rating_1: { label: 'Feedback round 1', actors: ['Attendee'] },
  },
};
