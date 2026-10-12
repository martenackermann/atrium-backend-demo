import { subject } from '@casl/ability';
import { Injectable } from '@nestjs/common';
import { type AnyMachineSnapshot, type AnyStateMachine, type StateValue, transition } from 'xstate';
import type { AuthUser } from '@/common/auth/auth-user';
import type { AppAbility, AppSubjectInstance } from '@/common/authz/ability.types';
import { assertCan } from '@/common/authz/check-ability.decorator';
import { ProblemException } from '@/common/http/problem';
import { isZodErrorLike, zodIssuesToFieldErrors } from '@/common/http/zod-errors';
import { PrismaService } from '@/database/prisma.service';
import { QueueService } from '@/infra/queue/queue.service';
import { stateValueToString } from './state-value';
import { WORKFLOW_NOTIFY_JOB } from './workflow.actions';
import type {
  NotifyParams,
  PersistedState,
  TransitionResult,
  WorkflowDefinition,
  WorkflowNotificationJob,
  WorkflowView,
} from './workflow.types';

export interface ApplyTransitionParams {
  id: string;
  action: string;
  actor: AuthUser;
  ability: AppAbility;
  /** Raw request body; validated with the action's `input` schema. */
  input?: unknown;
}

/**
 * Generic engine behind every `POST /<resource>/:id/actions/:action` endpoint:
 * evaluates XState machines against persisted state, lists the actions a user may take
 * (machine guards AND CASL), and applies transitions atomically with audit + notifications.
 */
@Injectable()
export class WorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  /** (a) Machine snapshot for a persisted state. */
  snapshotOf<TMachine extends AnyStateMachine>(machine: TMachine, state: PersistedState<unknown>): AnyMachineSnapshot {
    return machine.resolveState({ value: state.value, context: state.context });
  }

  /** (b) Action slugs `actor` can perform on `entity` now: machine guards pass AND the ability allows it. */
  availableActions<TEntity extends object>(
    def: WorkflowDefinition<AnyStateMachine, TEntity>,
    entity: TEntity,
    actor: AuthUser,
    ability: AppAbility,
  ): string[] {
    const snapshot = this.snapshotOf(def.machine, def.toState(entity));
    const tagged = this.asSubject(def, entity);
    return Object.entries(def.actions)
      .filter(([slug, action]) => ability.can(action.ability ?? slug, tagged))
      .filter(([, action]) => snapshot.can({ type: action.event, actor, input: undefined }))
      .map(([slug]) => slug);
  }

  /** State + available actions, for embedding in API responses. */
  view<TEntity extends object>(
    def: WorkflowDefinition<AnyStateMachine, TEntity>,
    entity: TEntity,
    actor: AuthUser,
    ability: AppAbility,
  ): WorkflowView {
    return { state: def.toState(entity).value, availableActions: this.availableActions(def, entity, actor, ability) };
  }

  /**
   * (c) Applies an action in one Prisma transaction: load -> permission -> guard check ->
   * transition -> persist -> audit entry -> notification jobs. Any failure rolls back all of it.
   * Errors: 404 unknown entity/action, 403 not allowed, 422 invalid input,
   * 409 action not available in the current state or concurrent modification.
   */
  async apply<TEntity extends object>(
    def: WorkflowDefinition<AnyStateMachine, TEntity>,
    params: ApplyTransitionParams,
  ): Promise<TransitionResult<TEntity>> {
    const action = Object.hasOwn(def.actions, params.action) ? def.actions[params.action] : undefined;
    if (!action) throw ProblemException.notFound('Action', params.action);
    const input = action.input ? this.parseInput(action.input, params.input) : undefined;

    return this.prisma.$transaction(async (tx) => {
      const entity = await def.load(tx, params.id);
      if (!entity) throw ProblemException.notFound(String(def.subjectType), params.id);
      assertCan(params.ability, action.ability ?? params.action, this.asSubject(def, entity));

      const persisted = def.toState(entity);
      const snapshot = this.snapshotOf(def.machine, persisted);
      const event = { type: action.event, actor: params.actor, input };
      if (!snapshot.can(event)) throw ProblemException.invalidTransition(params.action, persisted.value);

      const [next, executed] = transition(def.machine, snapshot, event);
      const toState = stateValueToString(next.value as StateValue);
      const change = { action: params.action, fromState: persisted.value, toState, actor: params.actor, input };

      const updated = await def.persist(tx, entity, { value: toState, context: next.context as never }, change);
      if (!updated) throw ProblemException.conflict('The resource was changed by someone else. Reload and try again.');

      const entityId = def.entityId(entity);
      await tx.auditEntry.create({
        data: {
          entityType: String(def.subjectType),
          entityId,
          action: params.action,
          fromState: persisted.value,
          toState,
          actorId: params.actor.id,
          data: { workflow: def.name, ...(input === undefined ? {} : { input }) },
        },
      });

      const notifications = (executed as { type: string; params?: unknown }[])
        .filter((a) => a.type === 'notify')
        .map((a): WorkflowNotificationJob => ({
          ...(a.params as NotifyParams),
          workflow: def.name,
          entityType: String(def.subjectType),
          entityId,
          action: params.action,
          fromState: persisted.value,
          toState,
          actorId: params.actor.id,
        }));
      for (const job of notifications) {
        await this.queue.send(WORKFLOW_NOTIFY_JOB, job, { tx });
      }

      return { entity: updated, fromState: persisted.value, toState, notifications: notifications.length };
    });
  }

  private parseInput(schema: NonNullable<WorkflowDefinition['actions'][string]['input']>, raw: unknown): unknown {
    const result = schema.safeParse(raw ?? {});
    if (!result.success) {
      throw isZodErrorLike(result.error)
        ? ProblemException.validation(zodIssuesToFieldErrors(result.error.issues))
        : ProblemException.badRequest('Invalid input.');
    }
    return result.data;
  }

  private asSubject<TEntity extends object>(def: WorkflowDefinition<AnyStateMachine, TEntity>, entity: TEntity) {
    return subject(String(def.subjectType), entity as Record<string, unknown>) as unknown as AppSubjectInstance;
  }
}
