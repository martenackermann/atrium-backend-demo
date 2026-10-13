import type { AnyStateMachine, ContextFrom } from 'xstate';
import type { z } from 'zod';
import type { AuthUser } from '@/common/auth/auth-user';
import type { AppAbility, AppAction, AppSubjectType } from '@/common/authz/ability.types';
import type { ActingAs, ModuleName } from '@/common/domain/vocabulary';
import type { PrismaTx } from '@/database/prisma.types';

/**
 * Every event sent to a workflow machine carries the acting user and the validated action
 * input. Guards may use `event.actor` and `context`; they must NOT depend on `event.input`,
 * because availableActions is computed without input.
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

export interface ActionContext<TEntity> {
  tx: PrismaTx;
  entity: TEntity;
  actor: AuthUser;
  ability: AppAbility;
}

/** One `POST /<resource>/{id}/actions/{action}` action. The slug is snake_case (API.md §1). */
export interface WorkflowActionDef<TEntity = never> {
  /** XState event type. Defaults to the action slug. */
  event?: string;
  /**
   * CASL action checked on the entity (`ability.can(ability, subject(subjectType, row))`).
   * Default: the slug. Set `false` to skip CASL and rely on `authorize` only.
   */
  ability?: AppAction | false;
  /**
   * Relationship check (owner, approver, deputy, manager chain...). Return the actingAs for
   * the audit log, or false (-> 403). Runs after the CASL check.
   */
  authorize?: (ctx: ActionContext<TEntity>) => Promise<ActingAs | false> | ActingAs | false;
  /**
   * actingAs when `authorize` is absent. Default: 'admin' for it_admin, 'back_office' for the
   * module's back-office role, else 'self'.
   */
  actingAs?: ActingAs;
  /** Zod schema of the request body (use `z.strictObject`). No schema = body must be empty. */
  input?: z.ZodType;
}

export interface TransitionChange {
  action: string;
  fromState: string;
  toState: string;
  actor: AuthUser;
  actingAs: ActingAs;
  input: unknown;
  /** `input.reason` when the body has one (stored on the audit row). */
  reason: string | null;
}

/** Params of the `notify` machine action: a notification intent handled in `afterTransition`. */
export interface NotifyParams {
  /** Notification id from SPEC §7, e.g. "training.participation_declined". */
  kind: string;
  [key: string]: unknown;
}

/**
 * Binds a state machine to a persisted resource. Create with `defineWorkflow()` in
 * `src/modules/<m>/machines/<resource>.workflow.ts` (inside a provider when hooks need DI).
 */
export interface WorkflowDefinition<
  TMachine extends AnyStateMachine = AnyStateMachine,
  TEntity extends object = object,
> {
  /** API WorkflowName, e.g. `training_attendee` (also used in `GET /meta/workflows`). */
  name: string;
  module: ModuleName;
  /** snake_case audit entity type, e.g. `training_attendee`. */
  entityType: string;
  /** CASL subject type, normally the Prisma model name, e.g. `TrainingAttendee`. */
  subjectType: AppSubjectType;
  machine: TMachine;
  /** Action slug -> definition, in canonical machine order (availableActions keeps this order). */
  actions: Record<string, WorkflowActionDef<TEntity>>;
  entityId: (entity: TEntity) => string;
  /** Reads the machine state out of a row. */
  toState: (entity: TEntity) => PersistedState<ContextFrom<TMachine>>;
  /**
   * Loads the row the actor may SEE inside the transaction (null -> 404, D5).
   * Lock it with `lockRow(tx, 'table_name', id)` first so concurrent actions serialise.
   */
  load: (tx: PrismaTx, id: string, actor: AuthUser) => Promise<TEntity | null>;
  /**
   * Writes the new state (+ timestamps, decision fields, `version: { increment: 1 }`).
   * Return the updated row, or null when a compare-and-set lost (-> 409 version_conflict).
   */
  persist: (
    tx: PrismaTx,
    entity: TEntity,
    next: PersistedState<ContextFrom<TMachine>>,
    change: TransitionChange,
  ) => Promise<TEntity | null>;
  /**
   * Side effects in the same transaction after persist + audit: notifications
   * (`notifications.send(..., { tx })`), linked attachments, extra audit rows...
   * `notifies` lists the `notify` actions the machine executed during this transition.
   */
  afterTransition?: (ctx: {
    tx: PrismaTx;
    before: TEntity;
    entity: TEntity;
    change: TransitionChange;
    notifies: NotifyParams[];
  }) => Promise<void>;
  /** Label for audit rows, e.g. the attendee's name or the reference. */
  entityLabel?: (entity: TEntity) => string;
}

/** Identity helper for type inference. */
export function defineWorkflow<TMachine extends AnyStateMachine, TEntity extends object>(
  definition: WorkflowDefinition<TMachine, TEntity>,
): WorkflowDefinition<TMachine, TEntity> {
  return definition;
}

export interface TransitionResult<TEntity> {
  entity: TEntity;
  fromState: string;
  toState: string;
  actingAs: ActingAs;
}

export interface WorkflowView {
  state: string;
  availableActions: string[];
}
