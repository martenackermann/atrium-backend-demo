import type { NotifyParams } from './workflow.types';

/** Queue that receives notification intents from workflow transitions (handled by the core module). */
export const WORKFLOW_NOTIFY_JOB = 'workflow.notify';

/**
 * Action implementations every workflow machine spreads into `setup({ actions })`.
 * They are intentionally no-ops: WorkflowService evaluates transitions purely and turns
 * the resulting `notify` actions into queue jobs inside the database transaction.
 *
 * @example
 * setup({ actions: { ...workflowActions, recordApprover: assign(...) } })
 * // in a state: entry: { type: 'notify', params: { kind: 'training.request-approved', to: ['requester'] } }
 */
export const workflowActions = {
  notify: (_: unknown, _params: NotifyParams): void => undefined,
};
