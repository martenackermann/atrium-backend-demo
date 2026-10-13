import { setup } from 'xstate';
import type { IsoDate } from '@/common/time/time';
import type { WorkflowMeta } from '@/modules/core/meta/workflow.registry';
import { workflowActions } from '@/modules/core/workflow/workflow.actions';
import type { WorkflowEvent } from '@/modules/core/workflow/workflow.types';

/**
 * Travel request lifecycle (SPEC §5.2 + SPEC_RESOLUTIONS #11). Pure machine: guards only
 * read `context` (time is injected by the workflow's `toState`) and `event.actor`.
 * Notifications are `notify` actions on the transitions; the workflow sends them.
 */
export interface TravelMachineContext {
  travellerId: string;
  requesterId: string;
  /** Start instant (ms) - retry needs `startsAt > now`. */
  startsAtMs: number;
  /** Start date (APP_TIMEZONE) - approve needs start date ≥ today (#11). */
  startDay: IsoDate;
  /** Last trip day (end, or start for one-way) - cancellation while ≥ today (#24). */
  lastDay: IsoDate;
  nowMs: number;
  today: IsoDate;
  statusBeforeCancellation: 'to_book' | 'booked' | null;
}

type Comment = { comment?: string | null };
type Reason = { reason: string };

export type TravelMachineEvent =
  | WorkflowEvent<'approve', Comment>
  | WorkflowEvent<'decline', Reason>
  | WorkflowEvent<'withdraw', { reason?: string | null }>
  | WorkflowEvent<'request_cancellation', Reason>
  | WorkflowEvent<'confirm_cancellation', Comment>
  | WorkflowEvent<'reject_cancellation', Reason>
  | WorkflowEvent<'book', unknown>
  | WorkflowEvent<'mark_booking_impossible', Reason>
  | WorkflowEvent<'retry_booking', Comment>
  | WorkflowEvent<'close', Reason>;

const notify = (kind: string) => ({ type: 'notify' as const, params: { kind } });

export const travelRequestMachine = setup({
  types: { context: {} as TravelMachineContext, events: {} as TravelMachineEvent },
  guards: {
    actorIsNotTraveller: ({ context, event }) => event.actor.id !== context.travellerId,
    canApprove: ({ context, event }) => event.actor.id !== context.travellerId && context.startDay >= context.today,
    startsInFuture: ({ context }) => context.startsAtMs > context.nowMs,
    tripNotOver: ({ context }) => context.lastDay >= context.today,
    wasToBook: ({ context }) => context.statusBeforeCancellation === 'to_book',
  },
  actions: { ...workflowActions },
}).createMachine({
  id: 'travelRequest',
  initial: 'pending_approval',
  context: {
    travellerId: '',
    requesterId: '',
    startsAtMs: 0,
    startDay: '1970-01-01',
    lastDay: '1970-01-01',
    nowMs: 0,
    today: '1970-01-01',
    statusBeforeCancellation: null,
  },
  states: {
    pending_approval: {
      on: {
        approve: { guard: 'canApprove', target: 'to_book', actions: notify('travel.approved') },
        decline: { guard: 'actorIsNotTraveller', target: 'declined', actions: notify('travel.declined') },
        withdraw: { target: 'cancelled', actions: notify('travel.withdrawn') },
      },
    },
    to_book: {
      on: {
        request_cancellation: {
          guard: 'tripNotOver',
          target: 'cancellation_requested',
          actions: notify('travel.cancellation_requested'),
        },
        book: { target: 'booked', actions: notify('travel.booked') },
        mark_booking_impossible: { target: 'booking_impossible', actions: notify('travel.booking_impossible') },
      },
    },
    booked: {
      on: {
        request_cancellation: {
          guard: 'tripNotOver',
          target: 'cancellation_requested',
          actions: notify('travel.cancellation_requested'),
        },
      },
    },
    booking_impossible: {
      on: {
        // Requester/traveller give up (SPEC_RESOLUTIONS #11) - nobody else needs a mail.
        withdraw: { target: 'cancelled' },
        retry_booking: { guard: 'startsInFuture', target: 'to_book' },
        close: { target: 'cancelled', actions: notify('travel.cancelled') },
      },
    },
    cancellation_requested: {
      on: {
        confirm_cancellation: { target: 'cancelled', actions: notify('travel.cancelled') },
        reject_cancellation: [
          { guard: 'wasToBook', target: 'to_book', actions: notify('travel.cancellation_rejected') },
          { target: 'booked', actions: notify('travel.cancellation_rejected') },
        ],
      },
    },
    declined: { type: 'final' },
    cancelled: { type: 'final' },
  },
});

/** `GET /meta/workflows/travel_request` (states with DESIGN tones, actor labels). */
export const travelRequestWorkflowMeta: WorkflowMeta = {
  name: 'travel_request',
  label: 'Travel request',
  machine: travelRequestMachine,
  initialStates: ['pending_approval', 'to_book'],
  states: {
    pending_approval: { label: 'Awaiting approval', tone: 'waiting' },
    to_book: { label: 'To book', tone: 'moving' },
    booked: { label: 'Booked', tone: 'positive' },
    booking_impossible: { label: 'Booking impossible', tone: 'blocked' },
    cancellation_requested: { label: 'Cancellation requested', tone: 'waiting' },
    declined: { label: 'Declined', tone: 'negative' },
    cancelled: { label: 'Cancelled', tone: 'neutral' },
  },
  events: {
    approve: { label: 'Approve', actors: ['Approver', 'Deputy', 'Manager chain'] },
    decline: { label: 'Decline', actors: ['Approver', 'Deputy', 'Manager chain'] },
    withdraw: { label: 'Withdraw', actors: ['Traveller', 'Requester'] },
    request_cancellation: { label: 'Request cancellation', actors: ['Traveller', 'Requester'] },
    confirm_cancellation: { label: 'Confirm cancellation', actors: ['Travel desk'] },
    reject_cancellation: { label: 'Reject cancellation', actors: ['Travel desk'] },
    book: { label: 'Book', actors: ['Travel desk'] },
    mark_booking_impossible: { label: 'Mark booking impossible', actors: ['Travel desk'] },
    retry_booking: { label: 'Retry booking', actors: ['Travel desk'] },
    close: { label: 'Close', actors: ['Travel desk'] },
  },
};
