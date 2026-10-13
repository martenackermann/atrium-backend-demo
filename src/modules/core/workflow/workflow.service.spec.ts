import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@/common/auth/auth-user';
import { createAppAbility } from '@/common/authz/ability.factory';
import type { AppAbility } from '@/common/authz/ability.types';
import { ProblemException } from '@/common/http/problem';
import type { PrismaService } from '@/database/prisma.service';
import type { PrismaTx } from '@/database/prisma.types';
import type { AuditInput, AuditService } from '../audit/audit.service';
import { describeWorkflow } from '../meta/workflow.registry';
import { type ToyRequest, toyRequestWorkflow, toyRequestWorkflowMeta } from './examples/toy-request.workflow';
import { stateValueToString } from './state-value';
import type { NotifyParams } from './workflow.types';
import { WorkflowService } from './workflow.service';

const owner: AuthUser = {
  id: 'u-owner',
  email: 'emma.employee@example.com',
  displayName: 'Emma Employee',
  roles: ['employee'],
  isSiteManager: false,
  sessionId: null,
};
const approver: AuthUser = { ...owner, id: 'u-approver', displayName: 'Max Manager', roles: ['employee', 'manager'] };

function abilityFor(user: AuthUser): AppAbility {
  return createAppAbility(user.roles.includes('manager') ? [{ action: 'decide', subject: 'ToyRequest' }] : []);
}

/** In-memory "database": transaction callbacks run on a copy that is only kept on success. */
function setup() {
  let rows = new Map<string, ToyRequest>();
  let audit: AuditInput[] = [];
  let notified: NotifyParams[] = [];

  const store = {
    find: (_tx: PrismaTx, id: string) => Promise.resolve(rows.get(id) ? { ...rows.get(id)! } : null),
    update: (_tx: PrismaTx, id: string, expectedVersion: number, patch: Partial<ToyRequest>) => {
      const current = rows.get(id);
      if (!current || current.version !== expectedVersion) return Promise.resolve(null);
      const updated = { ...current, ...patch };
      rows.set(id, updated);
      return Promise.resolve(updated);
    },
    notified: (n: NotifyParams[]) => notified.push(...n),
  };

  const prisma = {
    $transaction: vi.fn(async (fn: (tx: PrismaTx) => Promise<unknown>) => {
      const snapshot = { rows: new Map(rows), audit: [...audit], notified: [...notified] };
      try {
        return await fn({} as PrismaTx);
      } catch (error) {
        rows = snapshot.rows;
        audit = snapshot.audit;
        notified = snapshot.notified;
        throw error;
      }
    }),
  };
  const auditService = { record: vi.fn((input: AuditInput) => Promise.resolve(void audit.push(input))) };

  const service = new WorkflowService(prisma as unknown as PrismaService, auditService as unknown as AuditService);
  const workflow = toyRequestWorkflow(store);
  const insert = (row: Partial<ToyRequest> & { id: string }) =>
    rows.set(row.id, { ownerId: owner.id, status: 'draft', decidedBy: null, reason: null, version: 1, ...row });

  return { service, workflow, insert, rows: () => rows, audit: () => audit, notified: () => notified };
}

describe('stateValueToString', () => {
  it('flattens nested state values', () => {
    expect(stateValueToString('draft')).toBe('draft');
    expect(stateValueToString({ review: 'manager' })).toBe('review.manager');
    expect(stateValueToString({ a: { b: 'c' } })).toBe('a.b.c');
  });

  it('rejects parallel states', () => {
    expect(() => stateValueToString({ a: 'x', b: 'y' })).toThrow(/Parallel/);
  });
});

describe('WorkflowService (toy request machine)', () => {
  let t: ReturnType<typeof setup>;

  beforeEach(() => {
    t = setup();
    t.insert({ id: 'r1' });
  });

  it('resolves a machine snapshot from persisted state', () => {
    const snapshot = t.service.snapshotOf(t.workflow.machine, { value: 'submitted', context: { ownerId: owner.id } });
    expect(snapshot.value).toBe('submitted');
    expect(snapshot.context).toEqual({ ownerId: owner.id });
  });

  describe('availableActions', () => {
    it('combines machine guards, CASL and authorize hooks, in definition order', async () => {
      const draft = t.rows().get('r1')!;
      expect(await t.service.availableActions(t.workflow, draft, owner, abilityFor(owner))).toEqual(['submit']);
      expect(await t.service.availableActions(t.workflow, draft, approver, abilityFor(approver))).toEqual([]);

      const submitted = { ...draft, status: 'submitted' };
      expect(await t.service.availableActions(t.workflow, submitted, owner, abilityFor(owner))).toEqual(['withdraw']);
      expect(await t.service.availableActions(t.workflow, submitted, approver, abilityFor(approver))).toEqual([
        'approve',
        'decline',
      ]);
    });

    it('hides actions whose machine guard fails even when permissions allow them', async () => {
      const ownManager: AuthUser = { ...approver, id: owner.id }; // a manager may not approve their own request
      const submitted = { ...t.rows().get('r1')!, status: 'submitted' };
      expect(await t.service.availableActions(t.workflow, submitted, ownManager, abilityFor(ownManager))).toEqual([
        'withdraw',
      ]);
    });

    it('returns a view with state and actions', async () => {
      expect(await t.service.view(t.workflow, t.rows().get('r1')!, owner, abilityFor(owner))).toEqual({
        state: 'draft',
        availableActions: ['submit'],
      });
    });
  });

  describe('apply', () => {
    it('transitions, persists, audits and hands notify intents to afterTransition', async () => {
      const result = await t.service.apply(t.workflow, {
        id: 'r1',
        action: 'submit',
        actor: owner,
        ability: abilityFor(owner),
      });

      expect(result).toMatchObject({ fromState: 'draft', toState: 'submitted', actingAs: 'self' });
      expect(t.rows().get('r1')).toMatchObject({ status: 'submitted', version: 2 });
      expect(t.audit()).toEqual([
        expect.objectContaining({
          module: 'core',
          entityType: 'toy_request',
          entityId: 'r1',
          action: 'submit',
          fromState: 'draft',
          toState: 'submitted',
          actorId: owner.id,
          actingAs: 'self',
          reason: null,
        }),
      ]);
      expect(t.notified()).toEqual([{ kind: 'toy.submitted' }]);
    });

    it('validates the body (422), records the reason and the decision', async () => {
      t.insert({ id: 'r2', status: 'submitted' });
      const decline = (input: unknown) =>
        t.service.apply(t.workflow, {
          id: 'r2',
          action: 'decline',
          actor: approver,
          ability: abilityFor(approver),
          input,
        });

      await expect(decline({ reason: '' })).rejects.toMatchObject({
        problem: { status: 422, code: 'validation_failed', errors: { reason: [expect.any(String)] } },
      });
      await expect(decline({ reason: 'Budget exhausted', extra: 1 })).rejects.toMatchObject({
        problem: { status: 422 },
      });

      const result = await decline({ reason: 'Budget exhausted' });
      expect(result).toMatchObject({ toState: 'declined', actingAs: 'approver' });
      expect(t.rows().get('r2')).toMatchObject({
        status: 'declined',
        decidedBy: approver.id,
        reason: 'Budget exhausted',
      });
      expect(t.audit().at(-1)).toMatchObject({ action: 'decline', reason: 'Budget exhausted', actingAs: 'approver' });
      expect(t.notified()).toEqual([{ kind: 'toy.declined' }]);
    });

    it('records a comment as audit metadata when the body has no reason', async () => {
      t.insert({ id: 'r4', status: 'submitted' });
      const result = await t.service.apply(t.workflow, {
        id: 'r4',
        action: 'approve',
        actor: approver,
        ability: abilityFor(approver),
        input: { comment: 'Enjoy the course' },
      });
      expect(t.audit().at(-1)).toMatchObject({ action: 'approve', reason: null, metadata: { comment: 'Enjoy the course' } });
      expect(result.toState).toBe('approved');
    });

    it('merges the auditMetadata hook (onBehalfOfName) and lets it suppress the comment', async () => {
      const hook = vi.fn(() => ({ onBehalfOfName: 'Priya Raman', comment: null }));
      t.insert({ id: 'r5', status: 'submitted' });
      await t.service.apply(
        { ...t.workflow, auditMetadata: hook },
        { id: 'r5', action: 'approve', actor: approver, ability: abilityFor(approver), input: { comment: 'internal' } },
      );
      expect(hook).toHaveBeenCalledWith(expect.objectContaining({ action: 'approve', actingAs: 'approver' }));
      expect(t.audit().at(-1)?.metadata).toEqual({ onBehalfOfName: 'Priya Raman' });
    });

    it('stores no metadata when there is nothing to add', async () => {
      await t.service.apply(t.workflow, { id: 'r1', action: 'submit', actor: owner, ability: abilityFor(owner) });
      expect(t.audit().at(-1)?.metadata).toBeNull();
    });

    it('rejects a body for actions without input', async () => {
      await expect(
        t.service.apply(t.workflow, {
          id: 'r1',
          action: 'submit',
          actor: owner,
          ability: abilityFor(owner),
          input: { x: 1 },
        }),
      ).rejects.toMatchObject({ problem: { status: 422 } });
    });

    it('answers 409 invalid_transition when permitted but not available in the state', async () => {
      const error = await t.service
        .apply(t.workflow, { id: 'r1', action: 'approve', actor: approver, ability: abilityFor(approver) })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProblemException);
      expect((error as ProblemException).problem).toMatchObject({ status: 409, code: 'invalid_transition' });
      expect(t.audit()).toHaveLength(0);
    });

    it('answers 403 when the permission check fails', async () => {
      await expect(
        t.service.apply(t.workflow, { id: 'r1', action: 'submit', actor: approver, ability: abilityFor(approver) }),
      ).rejects.toMatchObject({ problem: { status: 403, code: 'forbidden' } });
      t.insert({ id: 'r3', status: 'submitted' });
      await expect(
        t.service.apply(t.workflow, { id: 'r3', action: 'approve', actor: owner, ability: abilityFor(owner) }),
      ).rejects.toMatchObject({ problem: { status: 403 } });
    });

    it('answers 404 for unknown entities and actions', async () => {
      const base = { actor: owner, ability: abilityFor(owner) };
      for (const [id, action] of [
        ['nope', 'submit'],
        ['r1', 'explode'],
        ['r1', 'toString'],
      ]) {
        await expect(t.service.apply(t.workflow, { ...base, id: id, action: action })).rejects.toMatchObject({
          problem: { status: 404, code: 'not_found' },
        });
      }
    });

    it('answers 409 version_conflict and rolls back when persist loses a race', async () => {
      const workflow = { ...t.workflow, persist: () => Promise.resolve(null) };
      await expect(
        t.service.apply(workflow, { id: 'r1', action: 'submit', actor: owner, ability: abilityFor(owner) }),
      ).rejects.toMatchObject({ problem: { status: 409, code: 'version_conflict' } });
      expect(t.rows().get('r1')?.status).toBe('draft');
      expect(t.audit()).toHaveLength(0);
    });
  });
});

describe('describeWorkflow (GET /meta/workflows/{name})', () => {
  it('derives states and transitions from the machine', () => {
    const view = describeWorkflow(toyRequestWorkflowMeta);
    expect(view.states).toEqual([
      { id: 'draft', label: 'Draft', tone: 'neutral', terminal: false },
      { id: 'submitted', label: 'Submitted', tone: 'waiting', terminal: false },
      { id: 'approved', label: 'Approved', tone: 'positive', terminal: true },
      { id: 'declined', label: 'Declined', tone: 'negative', terminal: true },
    ]);
    expect(view.transitions).toEqual([
      { from: 'draft', to: 'submitted', event: 'submit', label: 'Submit', actors: ['Owner'] },
      { from: 'submitted', to: 'draft', event: 'withdraw', label: 'Withdraw', actors: ['Owner'] },
      { from: 'submitted', to: 'approved', event: 'approve', label: 'Approve', actors: ['Approver'] },
      { from: 'submitted', to: 'declined', event: 'decline', label: 'Decline', actors: ['Approver'] },
    ]);
  });
});
