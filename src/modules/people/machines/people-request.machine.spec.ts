import { describe, expect, it } from 'vitest';
import { getNextTransitions, transition } from 'xstate';
import type { AuthUser } from '@/common/auth/auth-user';
import { describeWorkflow } from '@/modules/core/meta/workflow.registry';
import { peopleRequestWorkflowMeta } from '../people.enums';
import { peopleRequestMachine } from './people-request.machine';

const actor: AuthUser = {
  id: 'u-ops',
  email: 'paula.people-ops@example.com',
  displayName: 'Paula People-Ops',
  roles: ['employee', 'people_ops'],
  isSiteManager: false,
  sessionId: null,
};

const snapshot = (value: string) =>
  peopleRequestMachine.resolveState({ value, context: { requesterId: 'u-requester' } });

const fire = (from: string, type: string) => {
  const [next, actions] = transition(peopleRequestMachine, snapshot(from), {
    type,
    actor,
    input: { note: 'n', question: 'q?', reason: 'because', body: 'b' },
  } as never);
  return { to: next.value as string, notifies: actions.filter((a) => a.type === 'notify').map((a) => a.params) };
};

/** SPEC §5.4 transition table: [from, event, to, notification]. */
const TABLE: [string, string, string, string][] = [
  ['open', 'start_work', 'in_progress', 'people.status_changed'],
  ['reopened', 'start_work', 'in_progress', 'people.status_changed'],
  ['in_progress', 'wait_internal', 'waiting_internal', 'people.status_changed'],
  ['in_progress', 'wait_on_requester', 'waiting_on_requester', 'people.status_changed'],
  ['waiting_internal', 'resume', 'in_progress', 'people.status_changed'],
  ['waiting_on_requester', 'resume', 'in_progress', 'people.status_changed'],
  ['waiting_on_requester', 'requester_replied', 'in_progress', 'people.comment_added'],
  ['in_progress', 'complete', 'completed', 'people.status_changed'],
  ['waiting_internal', 'complete', 'completed', 'people.status_changed'],
  ['waiting_on_requester', 'complete', 'completed', 'people.status_changed'],
  ...['open', 'in_progress', 'waiting_internal', 'waiting_on_requester', 'reopened'].flatMap<
    [string, string, string, string]
  >((from) => [
    [from, 'reject', 'rejected', 'people.status_changed'],
    [from, 'cancel', 'cancelled', 'people.status_changed'],
  ]),
  ['completed', 'reopen', 'reopened', 'people.status_changed'],
  ['rejected', 'reopen', 'reopened', 'people.status_changed'],
];

describe('people request machine (SPEC §5.4)', () => {
  it.each(TABLE)('%s --%s--> %s notifies %s', (from, event, to, kind) => {
    const result = fire(from, event);
    expect(result.to).toBe(to);
    expect(result.notifies).toEqual([{ kind }]);
  });

  it('allows exactly the transitions of the table and nothing else', () => {
    const states = [
      'open',
      'in_progress',
      'waiting_internal',
      'waiting_on_requester',
      'reopened',
      'completed',
      'rejected',
      'cancelled',
    ];
    for (const state of states) {
      const events = getNextTransitions(snapshot(state))
        .map((t) => t.eventType)
        .sort();
      const expected = TABLE.filter(([from]) => from === state)
        .map(([, event]) => event)
        .sort();
      expect({ state, events }).toEqual({ state, events: expected });
    }
  });

  it('treats cancelled as final and refuses events there', () => {
    expect(snapshot('cancelled').status).toBe('done');
    expect(snapshot('cancelled').can({ type: 'reopen', actor, input: { reason: 'x' } })).toBe(false);
  });

  it('describes the diagram with every state and transition', () => {
    const view = describeWorkflow(peopleRequestWorkflowMeta);
    expect(view.states.map((s) => s.id)).toHaveLength(8);
    expect(view.transitions).toHaveLength(TABLE.length);
    expect(view.states.find((s) => s.id === 'cancelled')).toMatchObject({ terminal: true, tone: 'neutral' });
  });
});
