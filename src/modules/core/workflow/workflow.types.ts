import type { AnyStateMachine, ContextFrom } from 'xstate';
import type { z } from 'zod';
import type { AuthUser } from '@/common/auth/auth-user';
import type { AppAction, AppSubjectType } from '@/common/authz/ability.types';
import type { PrismaTx } from '@/database/prisma.types';

/**
 * Every event sent to a workflow machine carries the acting user and the (validated)
 * action input. Guards may use `event.actor` and `context`; they must NOT depend on
 * `event.input`, because availability is computed without input.
 */
export interface WorkflowEvent<TType extends string = string, TInput = undefined> {
  type: TType;
  actor: AuthUser;
  input: TInput;
}

/** What a resource row stores: the state as a dotted string ("review.manager") and context. */
export interface PersistedState<TContext> {
  value: string;
  context: TContext;
}

/** One `POST /<resource>/:id/actions/<slug>` action. */
export interface WorkflowActionDef {
  /** XState event type sent for this action, e.g. "APPROVE". */
  event: string;
  /** CASL action checked on the entity. Defaults to the action slug. */
  ability?: AppAction;
  /** Zod schema for the request body; validated before the transition (422 on failure). */
  input?: z.ZodType;
}

export interface TransitionChange {
  action: string;
  fromState: string;
  toState: string;
  actor: AuthUser;
  input: unknown;
}

/**
 * Binds a state machine to a persisted resource. Create with `defineWorkflow()` in
 * `src/modules/<m>/machines/<resource>.workflow.ts`.
 */
export interface WorkflowDefinition<
  TMachine extends AnyStateMachine = AnyStateMachine,
  TEntity extends object = object,
> {
  /** Stable name, used in audit entries and notification jobs, e.g. "training-request". */
  name: string;
  /** CASL subject type and audit `entityType`, normally the Prisma model name. */
  subjectType: AppSubjectType;
  machine: TMachine;
  /** Action slug (URL segment) -> event + permission. */
  actions: Record<string, WorkflowActionDef>;
  entityId: (entity: TEntity) => string;
  /** Reads the machine state out of a row. */
  toState: (entity: TEntity) => PersistedState<ContextFrom<TMachine>>;
  /**
   * Loads the row inside the transition transaction. Lock it (`SELECT ... FOR UPDATE` via
   * `tx.$queryRaw`) or rely on `persist` doing a compare-and-set on the old state.
   */
  load: (tx: PrismaTx, id: string) => Promise<TEntity | null>;
  /**
   * Writes the new state (and anything else derived from the transition). Return `null`
   * when a compare-and-set found the row changed concurrently: the helper answers 409.
   */
  persist: (
    tx: PrismaTx,
    entity: TEntity,
    next: PersistedState<ContextFrom<TMachine>>,
    change: TransitionChange,
  ) => Promise<TEntity | null>;
}

/** Identity helper for type inference. */
export function defineWorkflow<TMachine extends AnyStateMachine, TEntity extends object>(
  definition: WorkflowDefinition<TMachine, TEntity>,
): WorkflowDefinition<TMachine, TEntity> {
  return definition;
}

/** Params of the `notify` machine action: a notification intent resolved by the core module. */
export interface NotifyParams {
  /** Notification kind, e.g. "training.request-submitted". */
  kind: string;
  /** Recipient roles relative to the entity, e.g. ["requester", "approver"]. */
  to?: string[];
  data?: Record<string, unknown>;
}

/**
 * Payload of `workflow.notify` jobs enqueued (in the transition transaction) for every
 * `notify` action the transition executed.
 */
export interface WorkflowNotificationJob extends NotifyParams {
  workflow: string;
  entityType: string;
  entityId: string;
  action: string;
  fromState: string;
  toState: string;
  actorId: string;
}

export interface TransitionResult<TEntity> {
  entity: TEntity;
  fromState: string;
  toState: string;
  /** Number of notification jobs enqueued. */
  notifications: number;
}

export interface WorkflowView {
  state: string;
  availableActions: string[];
}
