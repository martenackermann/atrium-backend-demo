import { transition } from 'xstate';
import { describe, expect, it } from 'vitest';
import type { AuthUser } from '@/common/auth/auth-user';
import { OrgSnapshot, type OrgUser } from '@/modules/core/approvals/approval-rules';
import { trainingAttendeeMachine } from './machines/training-attendee.machine';
import { planEntry } from './services/training-entry.service';
import { csvCell } from './services/training-queues.service';
import {
  formatDate,
  formatDateRange,
  formatMoney,
  isHighPriority,
  parseTrainingReference,
  ratingState,
  trainingReference,
} from './training.constants';

const user = (id: string, managerId: string | null, extra: Partial<OrgUser> = {}): OrgUser => ({
  id,
  displayName: id,
  email: `${id}@example.com`,
  jobTitle: null,
  active: true,
  isSiteManager: false,
  isExecutive: false,
  managerId,
  ...extra,
});

const org = new OrgSnapshot([
  user('ceo', null, { isExecutive: true, email: 'clara.ceo@example.com' }),
  user('cfo', 'ceo', { isExecutive: true }),
  user('head', 'ceo'),
  user('site', 'head', { isSiteManager: true }),
  user('tech', 'site'),
  user('emp', 'head'),
]);
const FALLBACK = 'clara.ceo@example.com';

describe('planEntry (SPEC §5.1 entry table)', () => {
  it('pending manager approval by default', () => {
    expect(planEntry(org, 'emp', 'emp', null, FALLBACK)).toMatchObject({
      initialState: 'pending_manager_approval',
      managerAuto: null,
      executiveAuto: null,
    });
  });

  it('executive attendee -> both steps auto', () => {
    expect(planEntry(org, 'cfo', 'cfo', 'ceo', FALLBACK)).toMatchObject({
      initialState: 'to_book',
      managerAuto: 'executive_self',
      executiveAuto: 'executive_self',
    });
  });

  it('requester is the approver: to_book, or pending executive with another executive, or same_approver', () => {
    expect(planEntry(org, 'emp', 'head', null, FALLBACK).initialState).toBe('to_book');
    expect(planEntry(org, 'emp', 'head', 'ceo', FALLBACK)).toMatchObject({
      initialState: 'pending_executive_approval',
      managerAuto: 'requester_is_approver',
    });
    expect(planEntry(org, 'head', 'ceo', 'ceo', FALLBACK)).toMatchObject({
      initialState: 'to_book',
      executiveAuto: 'same_approver',
    });
  });

  it('escalation past a site manager is recorded', () => {
    expect(planEntry(org, 'tech', 'site', null, FALLBACK).resolution).toMatchObject({
      reason: 'site_manager_escalation',
      escalatedFromId: 'site',
    });
  });
});

describe('attendee machine', () => {
  const actor = (id: string) =>
    ({ id, email: '', displayName: id, roles: ['employee'], isSiteManager: false, sessionId: null }) as AuthUser;
  const ctx = {
    attendeeId: 'emp',
    requesterId: 'emp',
    executiveApproverId: 'ceo' as string | null,
    startsOn: '2026-11-01',
    endsOn: '2026-11-02',
    today: '2026-10-13',
    statusBeforeCancellation: null as string | null,
  };
  const step = (value: string, type: string, by: string, context = ctx, input: object = {}) => {
    const snapshot = trainingAttendeeMachine.resolveState({ value, context });
    if (!snapshot.can({ type, actor: actor(by), input } as never)) return null;
    return String(transition(trainingAttendeeMachine, snapshot, { type, actor: actor(by), input } as never)[0].value);
  };

  it('manager approval leads to the executive step unless the executive is the actor or requester', () => {
    expect(step('pending_manager_approval', 'approve', 'head')).toBe('pending_executive_approval');
    expect(step('pending_manager_approval', 'approve', 'ceo')).toBe('to_book');
    expect(step('pending_manager_approval', 'approve', 'head', { ...ctx, requesterId: 'ceo' })).toBe('to_book');
    expect(step('pending_manager_approval', 'approve', 'head', { ...ctx, executiveApproverId: null })).toBe('to_book');
  });

  it('guards: no self approval, no approval after the start, cancellation until the end', () => {
    expect(step('pending_manager_approval', 'approve', 'emp')).toBeNull();
    expect(step('pending_manager_approval', 'approve', 'head', { ...ctx, startsOn: '2026-10-12' })).toBeNull();
    expect(step('pending_manager_approval', 'decline', 'head', { ...ctx, startsOn: '2026-10-12' })).toBe('declined');
    expect(step('booked', 'request_cancellation', 'emp', { ...ctx, endsOn: '2026-10-12' })).toBeNull();
    expect(step('booking_impossible', 'retry_booking', 'office', { ...ctx, startsOn: '2026-10-12' })).toBeNull();
  });

  it('reject_cancellation restores the previous state; rating 1 decides attendance', () => {
    expect(
      step('cancellation_requested', 'reject_cancellation', 'office', { ...ctx, statusBeforeCancellation: 'booked' }),
    ).toBe('booked');
    expect(
      step('cancellation_requested', 'reject_cancellation', 'office', { ...ctx, statusBeforeCancellation: 'to_book' }),
    ).toBe('to_book');
    expect(step('booked', 'submit_rating_1', 'emp', ctx, { participated: true })).toBe('attended');
    expect(step('booked', 'submit_rating_1', 'emp', ctx, { participated: false })).toBe('not_attended');
    expect(step('booking_impossible', 'close', 'office')).toBe('cancelled');
  });
});

describe('training helpers', () => {
  it('references', () => {
    expect(trainingReference(7)).toBe('TRN-000007');
    expect(parseTrainingReference('trn-000123')).toBe(123);
    expect(parseTrainingReference('TRN123')).toBe(123);
    expect(parseTrainingReference('Leadership')).toBeNull();
  });

  it('formats dates and money en-GB (DESIGN.md §10)', () => {
    expect(formatDate('2026-10-21', '2026-10-13')).toBe('Wed 21 Oct');
    expect(formatDate('2027-01-05', '2026-10-13')).toBe('Tue 5 Jan 2027');
    expect(formatDateRange('2026-10-21', '2026-10-23', '2026-10-13')).toBe('21–23 Oct');
    expect(formatDateRange('2026-10-30', '2026-11-02', '2026-10-13')).toBe('30 Oct – 2 Nov');
    expect(formatMoney(189000)).toBe('€1,890');
    expect(formatMoney(189050)).toBe('€1,890.50');
  });

  it('rating state and high priority', () => {
    const now = new Date('2026-10-13T10:00:00Z');
    const due = (iso: string, submitted = false) => ({ dueAt: new Date(iso), submittedAt: submitted ? now : null });
    expect(ratingState(due('2026-10-20T00:00:00Z'), now, 14)).toBe('upcoming');
    expect(ratingState(due('2026-10-10T00:00:00Z'), now, 14)).toBe('due');
    expect(ratingState(due('2026-09-20T00:00:00Z'), now, 14)).toBe('overdue');
    expect(ratingState(due('2026-09-20T00:00:00Z', true), now, 14)).toBe('submitted');
    expect(isHighPriority('to_book', '2026-10-20', '2026-10-13', 14)).toBe(true);
    expect(isHighPriority('to_book', '2026-10-12', '2026-10-13', 14)).toBe(false);
    expect(isHighPriority('booked', '2026-10-20', '2026-10-13', 14)).toBe(false);
  });

  it('csv cells are quoted and formula-safe', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
  });
});
