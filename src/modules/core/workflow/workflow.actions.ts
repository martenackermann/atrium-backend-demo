import type { PrismaTx } from '@/database/prisma.types';
import type { NotifyParams } from './workflow.types';

/**
 * Action implementations every workflow machine spreads into `setup({ actions })`.
 * They are no-ops: WorkflowService evaluates transitions purely and passes the executed
 * `notify` actions to the definition's `afterTransition` hook as `notifies`.
 *
 * @example
 * setup({ actions: { ...workflowActions, recordDecision: assign(...) } })
 * // in a state: entry: { type: 'notify', params: { kind: 'training.participation_approved' } }
 */
export const workflowActions = {
  notify: (_: unknown, _params: NotifyParams): void => undefined,
};

const TABLE_NAME = /^[a-z_][a-z0-9_]*$/;

/**
 * `SELECT ... FOR UPDATE` on one row (SPEC §6.4 concurrency). Call it first in a workflow's
 * `load` so concurrent actions on the same row are serialised.
 */
export async function lockRow(tx: PrismaTx, table: string, id: string): Promise<boolean> {
  if (!TABLE_NAME.test(table)) throw new Error(`Invalid table name "${table}"`);
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM "${table}" WHERE id = $1::uuid FOR UPDATE`,
    id,
  );
  return rows.length > 0;
}
