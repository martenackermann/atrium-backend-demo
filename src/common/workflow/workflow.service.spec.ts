import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@/common/auth/auth-user';
import { createAppAbility } from '@/common/authz/ability.factory';
import type { AppAbility } from '@/common/authz/ability.types';
import { ProblemException } from '@/common/http/problem';
import type { PrismaService } from '@/database/prisma.service';
import type { PrismaTx } from '@/database/prisma.types';
import type { QueueService } from '@/infra/queue/queue.service';
import { type ToyRequest, toyRequestWorkflow } from './examples/toy-request.workflow';
import { stateValueToString } from './state-value';
import { WORKFLOW_NOTIFY_JOB } from './workflow.actions';
import { WorkflowService } from './workflow.service';

const owner: AuthUser = { id: 'u-owner', email: 'emma.employee@example.com', roles: ['employee'] };
const approver: AuthUser = { id: 'u-approver', email: 'mia.manager@example.com', roles: ['manager'] };

function abilityFor(user: AuthUser): AppAbility {
  const rules: AppAbility['rules'] = [
    { action: 'submit', subject: 'ToyRequest', conditions: { ownerId: user.id } as never },
  ];
  if (user.roles.includes('manager')) rules.push({ action: 'decide', subject: 'ToyRequest' });
  return createAppAbility(rules);
}

/** In-memory "database": transaction callbacks run on a copy that is only kept on success. */
function setup() {
  let rows = new Map<string, ToyRequest>();
  let audit: unknown[] = [];
  const sent: { name: string; data: unknown; tx: unknown }[] = [];

  const store = {
    find: (_tx: PrismaTx, id: string) => Promise.resolve(rows.get(id) ? { ...rows.get(id)! } : null),
    update: (_tx: PrismaTx, id: string, expectedVersion: number, patch: Partial<ToyRequest>) => {
      const current = rows.get(id);
      if (!current || current.version !== expectedVersion) return Promise.resolve(null);
      const updated = { ...current, ...patch };
      rows.set(id, updated);
      return Promise.resolve(updated);
    },
  };

  const prisma = {
    $transaction: vi.fn(async (fn: (tx: PrismaTx) => Promise<unknown>) => {
      const snapshot = { rows: new Map(rows), audit: [...audit], sent: sent.length };
      const tx = { auditEntry: { create: vi.fn(({ data }: { data: unknown }) => audit.push(data)) } };
      try {
        return await fn(tx as unknown as PrismaTx);
      } catch (error) {
        rows = snapshot.rows;
        audit = snapshot.audit;
        sent.length = snapshot.sent;
        throw error;
      }
    }),
  };
  const queue = {
    send: vi.fn((name: string, data: unknown, options?: { tx?: unknown }) => {
      sent.push({ name, data, tx: options?.tx });
      return Promise.resolve('job-id');
    }),
  };

  const service = new WorkflowService(prisma as unknown as PrismaService, queue as unknown as QueueService);
  const workflow = toyRequestWorkflow(store);
  const insert = (row: Partial<ToyRequest> & { id: string }) =>
    rows.set(row.id, { ownerId: owner.id, status: 'draft', decidedBy: null, reason: null, version: 1, ...row });

  return { service, workflow, insert, rows: () => rows, audit: () => audit, sent };
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

  describe('snapshotOf', () => {
    it('resolves a machine snapshot from persisted state', () => {
      const snapshot = t.service.snapshotOf(t.workflow.machine, {
        value: 'submitted',
        context: { ownerId: owner.id },
      });
      expect(snapshot.value).toBe('submitted');
      expect(snapshot.context).toEqual({ ownerId: owner.id });
    });
  });

  describe('availableActions', () => {
    it('combines machine guards with abilities', () => {
      const draft = t.rows().get('r1')!;
      expect(t.service.availableActions(t.workflow, draft, owner, abilityFor(owner))).toEqual(['submit']);
      // approver has no submit permission on someone else's request, and nothing to decide in draft
      expect(t.service.availableActions(t.workflow, draft, approver, abilityFor(approver))).toEqual([]);

      const submitted = { ...draft, status: 'submitted' };
      expect(t.service.availableActions(t.workflow, submitted, owner, abilityFor(owner))).toEqual(['withdraw']);
      expect(t.service.availableActions(t.workflow, submitted, approver, abilityFor(approver))).toEqual([
        'approve',
        'reject',
      ]);
    });

    it('hides actions whose guard fails even when the ability allows them', () => {
      // a manager who owns the request may not approve it (guard: actorIsNotOwner)
      const ownManager: AuthUser = { ...approver, id: owner.id };
      const submitted = { ...t.rows().get('r1')!, status: 'submitted' };
      expect(t.service.availableActions(t.workflow, submitted, ownManager, abilityFor(ownManager))).toEqual([
        'withdraw',
      ]);
    });

    it('returns a view with state and actions', () => {
      expect(t.service.view(t.workflow, t.rows().get('r1')!, owner, abilityFor(owner))).toEqual({
        state: 'draft',
        availableActions: ['submit'],
      });
    });
  });

  describe('apply', () => {
    it('transitions, persists, audits and enqueues notifications in one transaction', async () => {
      const result = await t.service.apply(t.workflow, {
        id: 'r1',
        action: 'submit',
        actor: owner,
        ability: abilityFor(owner),
      });

      expect(result).toMatchObject({ fromState: 'draft', toState: 'submitted', notifications: 1 });
      expect(t.rows().get('r1')).toMatchObject({ status: 'submitted', version: 2 });
      expect(t.audit()).toEqual([
        expect.objectContaining({
          entityType: 'ToyRequest',
          entityId: 'r1',
          action: 'submit',
          fromState: 'draft',
          toState: 'submitted',
          actorId: owner.id,
        }),
      ]);
      expect(t.sent).toHaveLength(1);
      expect(t.sent[0]).toMatchObject({
        name: WORKFLOW_NOTIFY_JOB,
        data: { kind: 'toy.submitted', to: ['approvers'], workflow: 'toy-request', entityId: 'r1' },
      });
      expect(t.sent[0]?.tx).toBeDefined();
    });

    it('validates action input (422) and records it in context', async () => {
      t.insert({ id: 'r2', status: 'submitted' });
      const reject = (input: unknown) =>
        t.service.apply(t.workflow, {
          id: 'r2',
          action: 'reject',
          actor: approver,
          ability: abilityFor(approver),
          input,
        });

      await expect(reject({ reason: '' })).rejects.toMatchObject({
        problem: { status: 422, errors: { reason: [expect.any(String)] } },
      });

      const result = await reject({ reason: 'Budget exhausted' });
      expect(result.toState).toBe('rejected');
      expect(t.rows().get('r2')).toMatchObject({
        status: 'rejected',
        decidedBy: approver.id,
        reason: 'Budget exhausted',
      });
      expect(t.sent.at(-1)?.data).toMatchObject({ kind: 'toy.rejected', to: ['owner'] });
    });

    it('answers 409 when the action is not available in the current state', async () => {
      const error = await t.service
        .apply(t.workflow, { id: 'r1', action: 'approve', actor: approver, ability: abilityFor(approver) })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProblemException);
      expect((error as ProblemException).problem).toMatchObject({ status: 409, type: 'invalid-transition' });
      expect(t.audit()).toHaveLength(0);
      expect(t.sent).toHaveLength(0);
    });

    it('answers 403 when the ability forbids the action', async () => {
      await expect(
        t.service.apply(t.workflow, { id: 'r1', action: 'submit', actor: approver, ability: abilityFor(approver) }),
      ).rejects.toMatchObject({ problem: { status: 403 } });
    });

    it('answers 404 for unknown entities and actions', async () => {
      const base = { actor: owner, ability: abilityFor(owner) };
      await expect(t.service.apply(t.workflow, { ...base, id: 'nope', action: 'submit' })).rejects.toMatchObject({
        problem: { status: 404 },
      });
      await expect(t.service.apply(t.workflow, { ...base, id: 'r1', action: 'explode' })).rejects.toMatchObject({
        problem: { status: 404 },
      });
      await expect(t.service.apply(t.workflow, { ...base, id: 'r1', action: 'toString' })).rejects.toMatchObject({
        problem: { status: 404 },
      });
    });

    it('answers 409 and rolls back on a concurrent modification', async () => {
      const workflow = {
        ...t.workflow,
        persist: () => Promise.resolve(null),
      };
      await expect(
        t.service.apply(workflow, { id: 'r1', action: 'submit', actor: owner, ability: abilityFor(owner) }),
      ).rejects.toMatchObject({ problem: { status: 409, type: 'conflict' } });
      expect(t.rows().get('r1')?.status).toBe('draft');
      expect(t.audit()).toHaveLength(0);
    });
  });
});
