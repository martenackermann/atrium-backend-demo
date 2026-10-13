import { setup } from 'xstate';
import type { WorkflowMeta } from '@/modules/core/meta/workflow.registry';
import { workflowActions } from '@/modules/core/workflow/workflow.actions';
import type { WorkflowEvent } from '@/modules/core/workflow/workflow.types';
import type { ReturnConditionValue } from '../assets.domain';

/** What the machine needs to know about an asset row (SPEC §5.3). */
export interface AssetMachineContext {
  /** The user of the open assignment (pending or accepted), if any. */
  assignedUserId: string | null;
  /** An open assignment exists and was accepted (complete_repair returns the device to the user). */
  hasAcceptedAssignment: boolean;
  /** Soft-deleted assets accept no transitions. */
  deleted: boolean;
}

export type AssetEvent =
  | WorkflowEvent<'assign', { userId: string; note: string | null }>
  | WorkflowEvent<'accept', { platformId: string | null }>
  | WorkflowEvent<'decline', { reason: string }>
  | WorkflowEvent<'unassign', { reason: string | null }>
  | WorkflowEvent<'return', { condition: ReturnConditionValue; note: string | null }>
  | WorkflowEvent<'send_to_repair', { note: string }>
  | WorkflowEvent<'complete_repair', { note: string | null }>
  | WorkflowEvent<'scrap', { reason: string }>;

/**
 * Asset lifecycle (SPEC §5.3). Pure: no services, no I/O. Guards only use the actor and the
 * context, except `returnsDamaged`, which picks the *target* of `return` from the body (the
 * unguarded fallback keeps `return` available when availableActions is computed without input).
 */
export const assetMachine = setup({
  types: { context: {} as AssetMachineContext, events: {} as AssetEvent },
  guards: {
    notDeleted: ({ context }) => !context.deleted,
    actorIsAssignee: ({ context, event }) =>
      context.assignedUserId !== null && event.actor.id === context.assignedUserId,
    hasAcceptedAssignment: ({ context }) => context.hasAcceptedAssignment,
    returnsDamaged: ({ event }) =>
      event.type === 'return' && (event.input as { condition?: string } | undefined)?.condition === 'damaged',
  },
  actions: { ...workflowActions },
}).createMachine({
  id: 'asset',
  initial: 'in_stock',
  context: { assignedUserId: null, hasAcceptedAssignment: false, deleted: false },
  states: {
    in_stock: {
      on: {
        assign: {
          guard: 'notDeleted',
          target: 'pending_acceptance',
          actions: { type: 'notify', params: { kind: 'assets.assignment_pending' } },
        },
        send_to_repair: { guard: 'notDeleted', target: 'in_repair' },
        scrap: { guard: 'notDeleted', target: 'scrapped' },
      },
    },
    pending_acceptance: {
      on: {
        accept: {
          guard: 'actorIsAssignee',
          target: 'in_use',
          actions: { type: 'notify', params: { kind: 'assets.assignment_accepted' } },
        },
        decline: {
          guard: 'actorIsAssignee',
          target: 'in_stock',
          actions: { type: 'notify', params: { kind: 'assets.assignment_declined' } },
        },
        unassign: { target: 'in_stock' },
      },
    },
    in_use: {
      on: {
        return: [
          {
            guard: 'returnsDamaged',
            target: 'in_repair',
            actions: { type: 'notify', params: { kind: 'assets.returned' } },
          },
          { target: 'in_stock', actions: { type: 'notify', params: { kind: 'assets.returned' } } },
        ],
        send_to_repair: { target: 'in_repair' },
      },
    },
    in_repair: {
      on: {
        complete_repair: [{ guard: 'hasAcceptedAssignment', target: 'in_use' }, { target: 'in_stock' }],
        scrap: { target: 'scrapped' },
      },
    },
    scrapped: { type: 'final' },
  },
});

/** Diagram metadata for `GET /meta/workflows/asset` (tones from DESIGN.md §2.4). */
export const assetWorkflowMeta: WorkflowMeta = {
  name: 'asset',
  label: 'Asset',
  machine: assetMachine,
  initialStates: ['in_stock'],
  states: {
    in_stock: { label: 'In stock', tone: 'neutral' },
    pending_acceptance: { label: 'Waiting for acceptance', tone: 'waiting' },
    in_use: { label: 'In use', tone: 'positive' },
    in_repair: { label: 'In repair', tone: 'blocked' },
    scrapped: { label: 'Scrapped', tone: 'neutral' },
  },
  events: {
    assign: { label: 'Assign', actors: ['Asset admin'] },
    accept: { label: 'Accept', actors: ['Assigned user'] },
    decline: { label: 'Decline', actors: ['Assigned user'] },
    unassign: { label: 'Unassign', actors: ['Asset admin'] },
    return: { label: 'Return', actors: ['Asset admin'] },
    send_to_repair: { label: 'Send to repair', actors: ['Asset admin'] },
    complete_repair: { label: 'Complete repair', actors: ['Asset admin'] },
    scrap: { label: 'Scrap', actors: ['Asset admin'] },
  },
};
