import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAppAbility } from '@/common/authz/ability.factory';
import type { AppAbility } from '@/common/authz/ability.types';
import { type ToyRequest, toyRequestWorkflow } from '@/common/workflow/examples/toy-request.workflow';
import { WORKFLOW_NOTIFY_JOB } from '@/common/workflow/workflow.actions';
import { WorkflowService } from '@/common/workflow/workflow.service';
import type { PrismaTx } from '@/database/prisma.types';
import { QueueService } from '@/infra/queue/queue.service';
import { createTestApp, type TestApp } from '../support/test-app';

/**
 * Proves the workflow helper against the real database: transition, audit entry and
 * pg-boss notification job commit (or roll back) together. The toy rows are stored as
 * SystemSetting JSON so no extra table is needed.
 */
const owner = { id: 'u-owner', email: 'emma.employee@example.com', roles: ['employee'] };
const ownerAbility: AppAbility = createAppAbility([{ action: 'submit', subject: 'ToyRequest' }]);

const store = {
  async find(tx: PrismaTx, id: string): Promise<ToyRequest | null> {
    const row = await tx.systemSetting.findUnique({ where: { key: `toy:${id}` } });
    return row ? (row.value as unknown as ToyRequest) : null;
  },
  async update(tx: PrismaTx, id: string, expectedVersion: number, patch: Partial<ToyRequest>) {
    const current = await store.find(tx, id);
    if (!current || current.version !== expectedVersion) return null;
    const next = { ...current, ...patch };
    await tx.systemSetting.update({ where: { key: `toy:${id}` }, data: { value: next as never } });
    return next;
  },
};

async function jobCount(t: TestApp, entityId: string): Promise<number> {
  const rows = await t.prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT count(*) AS count FROM pgboss.job WHERE name = $1 AND data->>'entityId' = $2`,
    WORKFLOW_NOTIFY_JOB,
    entityId,
  );
  return Number(rows[0]?.count ?? 0);
}

describe('workflow transitions against Postgres', () => {
  let t: TestApp;
  let workflows: WorkflowService;

  beforeAll(async () => {
    t = await createTestApp();
    workflows = t.app.get(WorkflowService);
  });

  afterAll(async () => {
    await t?.close();
  });

  it('persists state, audit entry and notification job in one transaction', async () => {
    const id = randomUUID();
    const row: ToyRequest = { id, ownerId: owner.id, status: 'draft', decidedBy: null, reason: null, version: 1 };
    await t.prisma.systemSetting.create({ data: { key: `toy:${id}`, value: row as never } });

    const result = await workflows.apply(toyRequestWorkflow(store), {
      id,
      action: 'submit',
      actor: owner,
      ability: ownerAbility,
    });

    expect(result).toMatchObject({ fromState: 'draft', toState: 'submitted', notifications: 1 });
    expect(await store.find(t.prisma, id)).toMatchObject({ status: 'submitted', version: 2 });
    const audit = await t.prisma.auditEntry.findMany({ where: { entityId: id } });
    expect(audit).toEqual([
      expect.objectContaining({ entityType: 'ToyRequest', action: 'submit', fromState: 'draft', toState: 'submitted' }),
    ]);
    expect(await jobCount(t, id)).toBe(1);
  });

  it('rolls back the enqueued job when the transaction fails', async () => {
    const entityId = randomUUID();
    const queue = t.app.get(QueueService);
    await expect(
      t.prisma.$transaction(async (tx) => {
        await queue.send(WORKFLOW_NOTIFY_JOB, { entityId, kind: 'test' }, { tx });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await jobCount(t, entityId)).toBe(0);
  });
});
