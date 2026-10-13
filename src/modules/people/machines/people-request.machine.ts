import { setup } from 'xstate';
import { workflowActions, type WorkflowEvent } from '@/modules/core/workflow';

/**
 * SPEC §5.4 people request lifecycle. Pure: permissions live in the workflow definition
 * (CASL + `authorize`), side effects in `afterTransition` (via the `notify` intents).
 */
export interface PeopleRequestContext {
  requesterId: string;
}

export type PeopleRequestEvent =
  | WorkflowEvent<'start_work', { note: string | null }>
  | WorkflowEvent<'wait_internal', { note: string }>
  | WorkflowEvent<'wait_on_requester', { question: string }>
  | WorkflowEvent<'resume', { note: string | null }>
  | WorkflowEvent<'requester_replied', { body: string }>
  | WorkflowEvent<'complete', { note: string | null }>
  | WorkflowEvent<'reject', { reason: string }>
  | WorkflowEvent<'cancel', { reason: string }>
  | WorkflowEvent<'reopen', { reason: string }>;

const statusChanged = { type: 'notify', params: { kind: 'people.status_changed' } } as const;
const commentAdded = { type: 'notify', params: { kind: 'people.comment_added' } } as const;

export const peopleRequestMachine = setup({
  types: { context: {} as PeopleRequestContext, events: {} as PeopleRequestEvent },
  actions: { ...workflowActions },
}).createMachine({
  id: 'peopleRequest',
  initial: 'open',
  context: { requesterId: '' },
  states: {
    open: {
      on: {
        start_work: { target: 'in_progress', actions: statusChanged },
        reject: { target: 'rejected', actions: statusChanged },
        cancel: { target: 'cancelled', actions: statusChanged },
      },
    },
    in_progress: {
      on: {
        wait_internal: { target: 'waiting_internal', actions: statusChanged },
        wait_on_requester: { target: 'waiting_on_requester', actions: statusChanged },
        complete: { target: 'completed', actions: statusChanged },
        reject: { target: 'rejected', actions: statusChanged },
        cancel: { target: 'cancelled', actions: statusChanged },
      },
    },
    waiting_internal: {
      on: {
        resume: { target: 'in_progress', actions: statusChanged },
        complete: { target: 'completed', actions: statusChanged },
        reject: { target: 'rejected', actions: statusChanged },
        cancel: { target: 'cancelled', actions: statusChanged },
      },
    },
    waiting_on_requester: {
      on: {
        resume: { target: 'in_progress', actions: statusChanged },
        requester_replied: { target: 'in_progress', actions: commentAdded },
        complete: { target: 'completed', actions: statusChanged },
        reject: { target: 'rejected', actions: statusChanged },
        cancel: { target: 'cancelled', actions: statusChanged },
      },
    },
    reopened: {
      on: {
        start_work: { target: 'in_progress', actions: statusChanged },
        reject: { target: 'rejected', actions: statusChanged },
        cancel: { target: 'cancelled', actions: statusChanged },
      },
    },
    completed: { on: { reopen: { target: 'reopened', actions: statusChanged } } },
    rejected: { on: { reopen: { target: 'reopened', actions: statusChanged } } },
    cancelled: { type: 'final' },
  },
});
