import { describe, expect, it } from 'vitest';
import { transition } from 'xstate';
import type { AuthUser } from '@/common/auth/auth-user';
import { describeWorkflow } from '@/modules/core/meta/workflow.registry';
import { type TravelMachineContext, travelRequestMachine, travelRequestWorkflowMeta } from './travel-request.machine';

const user = (id: string): AuthUser => ({
  id,
  email: `${id}@example.com`,
  displayName: id,
  roles: ['employee'],
  isSiteManager: false,
  sessionId: null,
});
const traveller = user('traveller');
const approver = user('approver');
const desk = user('desk');

const base: TravelMachineContext = {
  travellerId: 'traveller',
  requesterId: 'traveller',
  startsAtMs: Date.UTC(2026, 9, 20, 7),
  startDay: '2026-10-20',
  lastDay: '2026-10-21',
  nowMs: Date.UTC(2026, 9, 13, 10),
  today: '2026-10-13',
  statusBeforeCancellation: null,
};

function snap(value: string, context: Partial<TravelMachineContext> = {}) {
  return travelRequestMachine.resolveState({ value, context: { ...base, ...context } });
}

function run(value: string, type: string, actor: AuthUser, context: Partial<TravelMachineContext> = {}) {
  const snapshot = snap(value, context);
  const event = { type, actor, input: {} } as never;
  if (!snapshot.can(event)) return { to: null, notifies: [] as string[] };
  const [next, actions] = transition(travelRequestMachine, snapshot, event);
  return {
    to: next.value as string,
    notifies: (actions as { type: string; params?: { kind: string } }[])
      .filter((a) => a.type === 'notify')
      .map((a) => a.params!.kind),
  };
}

describe('travel request machine (SPEC §5.2)', () => {
  it('approve / decline / withdraw from pending_approval', () => {
    expect(run('pending_approval', 'approve', approver)).toEqual({ to: 'to_book', notifies: ['travel.approved'] });
    expect(run('pending_approval', 'decline', approver)).toEqual({ to: 'declined', notifies: ['travel.declined'] });
    expect(run('pending_approval', 'withdraw', traveller)).toEqual({ to: 'cancelled', notifies: ['travel.withdrawn'] });
  });

  it('the traveller can never decide their own trip', () => {
    expect(run('pending_approval', 'approve', traveller).to).toBeNull();
    expect(run('pending_approval', 'decline', traveller).to).toBeNull();
  });

  it('approve needs a start date of today or later (#11); decline stays possible', () => {
    const past = { startDay: '2026-10-12', startsAtMs: Date.UTC(2026, 9, 12, 7) };
    expect(run('pending_approval', 'approve', approver, past).to).toBeNull();
    expect(run('pending_approval', 'approve', approver, { startDay: '2026-10-13' }).to).toBe('to_book');
    expect(run('pending_approval', 'decline', approver, past).to).toBe('declined');
  });

  it('desk transitions from to_book', () => {
    expect(run('to_book', 'book', desk)).toEqual({ to: 'booked', notifies: ['travel.booked'] });
    expect(run('to_book', 'mark_booking_impossible', desk)).toEqual({
      to: 'booking_impossible',
      notifies: ['travel.booking_impossible'],
    });
  });

  it('booking_impossible: retry only for future starts, close and withdraw (#11)', () => {
    expect(run('booking_impossible', 'retry_booking', desk).to).toBe('to_book');
    expect(run('booking_impossible', 'retry_booking', desk, { startsAtMs: base.nowMs - 1 }).to).toBeNull();
    expect(run('booking_impossible', 'close', desk)).toEqual({ to: 'cancelled', notifies: ['travel.cancelled'] });
    expect(run('booking_impossible', 'withdraw', traveller)).toEqual({ to: 'cancelled', notifies: [] });
  });

  it('cancellation while the trip is not over (#24), reject restores the previous state', () => {
    expect(run('booked', 'request_cancellation', traveller).to).toBe('cancellation_requested');
    expect(run('to_book', 'request_cancellation', traveller).to).toBe('cancellation_requested');
    expect(run('booked', 'request_cancellation', traveller, { lastDay: '2026-10-12' }).to).toBeNull();
    expect(run('booked', 'request_cancellation', traveller, { lastDay: '2026-10-13' }).to).toBe(
      'cancellation_requested',
    );
    expect(run('cancellation_requested', 'confirm_cancellation', desk).to).toBe('cancelled');
    expect(run('cancellation_requested', 'reject_cancellation', desk, { statusBeforeCancellation: 'to_book' }).to).toBe(
      'to_book',
    );
    expect(run('cancellation_requested', 'reject_cancellation', desk, { statusBeforeCancellation: 'booked' }).to).toBe(
      'booked',
    );
  });

  it('terminal states accept nothing', () => {
    for (const state of ['declined', 'cancelled']) {
      for (const type of ['approve', 'withdraw', 'book', 'request_cancellation', 'close']) {
        expect(run(state, type, desk).to).toBeNull();
      }
    }
  });

  it('describes the diagram for /meta/workflows', () => {
    const view = describeWorkflow(travelRequestWorkflowMeta);
    expect(view.initialStates).toEqual(['pending_approval', 'to_book']);
    expect(view.states.filter((s) => s.terminal).map((s) => s.id)).toEqual(['declined', 'cancelled']);
    expect(view.transitions).toContainEqual(
      expect.objectContaining({ from: 'cancellation_requested', to: 'booked', event: 'reject_cancellation' }),
    );
    expect(view.transitions).toContainEqual(
      expect.objectContaining({ from: 'booking_impossible', to: 'cancelled', event: 'close', actors: ['Travel desk'] }),
    );
  });
});
