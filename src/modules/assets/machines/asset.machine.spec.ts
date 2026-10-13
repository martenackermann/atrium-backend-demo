import { describe, expect, it } from 'vitest';
import { transition } from 'xstate';
import type { AuthUser } from '@/common/auth/auth-user';
import { type AssetEvent, type AssetMachineContext, assetMachine, assetWorkflowMeta } from './asset.machine';
import { describeWorkflow } from '@/modules/core/meta/workflow.registry';

const user = (id: string): AuthUser => ({
  id,
  email: `${id}@example.com`,
  displayName: id,
  roles: ['employee'],
  isSiteManager: false,
  sessionId: null,
});
const emma = user('emma');
const arne = user('arne');

const ctx = (patch: Partial<AssetMachineContext> = {}): AssetMachineContext => ({
  assignedUserId: null,
  hasAcceptedAssignment: false,
  deleted: false,
  ...patch,
});

function step(state: string, context: AssetMachineContext, event: AssetEvent) {
  const snapshot = assetMachine.resolveState({ value: state, context });
  if (!snapshot.can(event)) return null;
  const [next, actions] = transition(assetMachine, snapshot, event);
  return {
    state: next.value as string,
    notifies: actions.filter((a) => a.type === 'notify').map((a) => (a.params as { kind: string } | undefined)?.kind),
  };
}

const ev = <T extends AssetEvent['type']>(type: T, actor: AuthUser, input: unknown = undefined) =>
  ({ type, actor, input }) as AssetEvent;

describe('asset machine (SPEC §5.3)', () => {
  it('in_stock: assign -> pending_acceptance (notifies the user), send_to_repair, scrap', () => {
    expect(step('in_stock', ctx(), ev('assign', arne, { userId: 'emma', note: null }))).toEqual({
      state: 'pending_acceptance',
      notifies: ['assets.assignment_pending'],
    });
    expect(step('in_stock', ctx(), ev('send_to_repair', arne, { note: 'x' }))?.state).toBe('in_repair');
    expect(step('in_stock', ctx(), ev('scrap', arne, { reason: 'old' }))?.state).toBe('scrapped');
  });

  it('pending_acceptance: only the assigned user accepts or declines; admins unassign', () => {
    const pending = ctx({ assignedUserId: 'emma' });
    expect(step('pending_acceptance', pending, ev('accept', emma, { platformId: null }))).toEqual({
      state: 'in_use',
      notifies: ['assets.assignment_accepted'],
    });
    expect(step('pending_acceptance', pending, ev('decline', emma, { reason: 'nope' }))).toEqual({
      state: 'in_stock',
      notifies: ['assets.assignment_declined'],
    });
    expect(step('pending_acceptance', pending, ev('accept', arne))).toBeNull();
    expect(step('pending_acceptance', pending, ev('decline', arne))).toBeNull();
    expect(step('pending_acceptance', pending, ev('unassign', arne, { reason: null }))?.state).toBe('in_stock');
  });

  it('in_use: return ok -> in_stock, damaged -> in_repair; send_to_repair keeps the assignment', () => {
    const inUse = ctx({ assignedUserId: 'emma', hasAcceptedAssignment: true });
    expect(step('in_use', inUse, ev('return', arne, { condition: 'ok', note: null }))).toEqual({
      state: 'in_stock',
      notifies: ['assets.returned'],
    });
    expect(step('in_use', inUse, ev('return', arne, { condition: 'damaged', note: null }))).toEqual({
      state: 'in_repair',
      notifies: ['assets.returned'],
    });
    // availableActions is computed without input: return stays available
    expect(step('in_use', inUse, ev('return', arne))?.state).toBe('in_stock');
    expect(step('in_use', inUse, ev('send_to_repair', arne, { note: 'screen' }))?.state).toBe('in_repair');
  });

  it('in_repair: complete_repair returns to the user only with an accepted assignment; scrap', () => {
    expect(
      step('in_repair', ctx({ assignedUserId: 'emma', hasAcceptedAssignment: true }), ev('complete_repair', arne))
        ?.state,
    ).toBe('in_use');
    expect(step('in_repair', ctx(), ev('complete_repair', arne))?.state).toBe('in_stock');
    expect(step('in_repair', ctx(), ev('scrap', arne, { reason: 'gone' }))?.state).toBe('scrapped');
  });

  it('scrapped is final and soft-deleted stock accepts nothing', () => {
    for (const type of ['assign', 'send_to_repair', 'scrap', 'complete_repair'] as const) {
      expect(step('scrapped', ctx(), ev(type, arne))).toBeNull();
      expect(step('in_stock', ctx({ deleted: true }), ev(type, arne))).toBeNull();
    }
  });

  it('rejects events that are not defined for a state', () => {
    expect(step('in_stock', ctx(), ev('accept', emma))).toBeNull();
    expect(step('in_use', ctx({ assignedUserId: 'emma' }), ev('assign', arne))).toBeNull();
    expect(step('pending_acceptance', ctx({ assignedUserId: 'emma' }), ev('scrap', arne))).toBeNull();
  });

  it('describes the diagram (5 states, 12 transitions)', () => {
    const view = describeWorkflow(assetWorkflowMeta);
    expect(view.states.map((s) => s.id)).toEqual(['in_stock', 'pending_acceptance', 'in_use', 'in_repair', 'scrapped']);
    expect(view.states.find((s) => s.id === 'scrapped')?.terminal).toBe(true);
    expect(view.transitions).toHaveLength(12);
  });
});
