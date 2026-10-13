/**
 * Reference example for module authors (and the subject of the workflow tests).
 * Not registered in the app. Real workflows live in src/modules/<m>/machines/.
 */
import { assign, setup } from 'xstate';
import { z } from 'zod';
import type { PrismaTx } from '@/database/prisma.types';
import type { WorkflowMeta } from '../../meta/workflow.registry';
import { workflowActions } from '../workflow.actions';
import { defineWorkflow, type NotifyParams, type WorkflowEvent } from '../workflow.types';

export interface ToyContext {
  ownerId: string;
  decidedBy?: string;
  reason?: string;
}

export type ToyEvent =
  | WorkflowEvent<'submit'>
  | WorkflowEvent<'withdraw'>
  | WorkflowEvent<'approve', { comment?: string }>
  | WorkflowEvent<'decline', { reason: string }>;

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
      reason: ({ event }) => (event.type === 'decline' ? event.input.reason : undefined),
    }),
  },
}).createMachine({
  id: 'toyRequest',
  initial: 'draft',
  context: { ownerId: '' },
  states: {
    draft: {
      on: { submit: { guard: 'actorIsOwner', target: 'submitted' } },
    },
    submitted: {
      entry: { type: 'notify', params: { kind: 'toy.submitted' } },
      on: {
        withdraw: { guard: 'actorIsOwner', target: 'draft' },
        approve: { guard: 'actorIsNotOwner', target: 'approved', actions: 'recordDecision' },
        decline: { guard: 'actorIsNotOwner', target: 'declined', actions: 'recordDecision' },
      },
    },
    approved: { type: 'final', entry: { type: 'notify', params: { kind: 'toy.approved' } } },
    declined: { type: 'final', entry: { type: 'notify', params: { kind: 'toy.declined' } } },
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

/** Storage port so the example runs against an in-memory map (unit test) or SystemSetting rows (e2e). */
export interface ToyRequestStore {
  find(tx: PrismaTx, id: string): Promise<ToyRequest | null>;
  /** Compare-and-set on `version`; returns null when the row changed meanwhile. */
  update(tx: PrismaTx, id: string, expectedVersion: number, patch: Partial<ToyRequest>): Promise<ToyRequest | null>;
  /** Receives notification intents (a real slice calls NotificationService.send here). */
  notified?(notifies: NotifyParams[]): void;
}

export function toyRequestWorkflow(store: ToyRequestStore) {
  return defineWorkflow({
    name: 'toy_request',
    module: 'core',
    entityType: 'toy_request',
    subjectType: 'ToyRequest',
    machine: toyRequestMachine,
    actions: {
      submit: { authorize: ({ entity, actor }) => (entity.ownerId === actor.id ? 'self' : false), ability: false },
      withdraw: { authorize: ({ entity, actor }) => (entity.ownerId === actor.id ? 'self' : false), ability: false },
      approve: {
        ability: 'decide',
        actingAs: 'approver',
        input: z.strictObject({ comment: z.string().max(2000).optional() }),
      },
      decline: {
        ability: 'decide',
        actingAs: 'approver',
        input: z.strictObject({ reason: z.string().trim().min(3).max(1000) }),
      },
    },
    entityId: (row: ToyRequest) => row.id,
    entityLabel: (row: ToyRequest) => `Toy ${row.id.slice(0, 8)}`,
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
    afterTransition: ({ notifies }) => {
      store.notified?.(notifies);
      return Promise.resolve();
    },
  });
}

/** Diagram metadata (what a slice registers via CoreExtensionsModule.forFeature({ workflows })). */
export const toyRequestWorkflowMeta: WorkflowMeta = {
  name: 'toy_request',
  label: 'Toy request',
  machine: toyRequestMachine,
  initialStates: ['draft'],
  states: {
    draft: { label: 'Draft', tone: 'neutral' },
    submitted: { label: 'Submitted', tone: 'waiting' },
    approved: { label: 'Approved', tone: 'positive' },
    declined: { label: 'Declined', tone: 'negative' },
  },
  events: {
    submit: { actors: ['Owner'] },
    withdraw: { actors: ['Owner'] },
    approve: { actors: ['Approver'] },
    decline: { actors: ['Approver'] },
  },
};
