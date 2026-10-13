/**
 * Reference example for module authors (and the subject of the workflow unit tests).
 * Not registered anywhere. Real workflows live in src/modules/<m>/machines/.
 */
import { assign, setup } from 'xstate';
import { z } from 'zod';
import type { PrismaTx } from '@/database/prisma.types';
import { workflowActions } from '../workflow.actions';
import { defineWorkflow, type WorkflowEvent } from '../workflow.types';

export interface ToyContext {
  ownerId: string;
  decidedBy?: string;
  reason?: string;
}

export type ToyEvent =
  | WorkflowEvent<'SUBMIT'>
  | WorkflowEvent<'WITHDRAW'>
  | WorkflowEvent<'APPROVE'>
  | WorkflowEvent<'REJECT', { reason: string }>;

export const toyRequestMachine = setup({
  types: { context: {} as ToyContext, events: {} as ToyEvent },
  guards: {
    actorIsOwner: ({ context, event }) => event.actor.id === context.ownerId,
    actorIsNotOwner: ({ context, event }) => event.actor.id !== context.ownerId,
  },
  actions: {
    ...workflowActions,
    recordDecision: assign({
      decidedBy: ({ event }) => event.actor.id,
      reason: ({ event }) => (event.type === 'REJECT' ? event.input.reason : undefined),
    }),
  },
}).createMachine({
  id: 'toyRequest',
  initial: 'draft',
  context: { ownerId: '' },
  states: {
    draft: {
      on: { SUBMIT: { guard: 'actorIsOwner', target: 'submitted' } },
    },
    submitted: {
      entry: { type: 'notify', params: { kind: 'toy.submitted', to: ['approvers'] } },
      on: {
        WITHDRAW: { guard: 'actorIsOwner', target: 'draft' },
        APPROVE: { guard: 'actorIsNotOwner', target: 'approved', actions: 'recordDecision' },
        REJECT: { guard: 'actorIsNotOwner', target: 'rejected', actions: 'recordDecision' },
      },
    },
    approved: {
      type: 'final',
      entry: { type: 'notify', params: { kind: 'toy.approved', to: ['owner'] } },
    },
    rejected: {
      type: 'final',
      entry: { type: 'notify', params: { kind: 'toy.rejected', to: ['owner'] } },
    },
  },
});

/** Shape of the (imaginary) table row. */
export interface ToyRequest {
  id: string;
  ownerId: string;
  status: string;
  decidedBy: string | null;
  reason: string | null;
  version: number;
}

/** Storage port so the example runs against an in-memory map in tests. */
export interface ToyRequestStore {
  find(tx: PrismaTx, id: string): Promise<ToyRequest | null>;
  /** Compare-and-set on `version`; returns null when the row changed meanwhile. */
  update(tx: PrismaTx, id: string, expectedVersion: number, patch: Partial<ToyRequest>): Promise<ToyRequest | null>;
}

export function toyRequestWorkflow(store: ToyRequestStore) {
  return defineWorkflow({
    name: 'toy-request',
    subjectType: 'ToyRequest',
    machine: toyRequestMachine,
    actions: {
      submit: { event: 'SUBMIT' },
      withdraw: { event: 'WITHDRAW', ability: 'submit' },
      approve: { event: 'APPROVE', ability: 'decide' },
      reject: { event: 'REJECT', ability: 'decide', input: z.object({ reason: z.string().trim().min(3) }) },
    },
    entityId: (row: ToyRequest) => row.id,
    toState: (row: ToyRequest) => ({
      value: row.status,
      context: { ownerId: row.ownerId, decidedBy: row.decidedBy ?? undefined, reason: row.reason ?? undefined },
    }),
    load: (tx, id) => store.find(tx, id),
    persist: (tx, row, next) =>
      store.update(tx, row.id, row.version, {
        status: next.value,
        decidedBy: next.context.decidedBy ?? null,
        reason: next.context.reason ?? null,
        version: row.version + 1,
      }),
  });
}
