import { subject } from '@casl/ability';
import { Injectable } from '@nestjs/common';
import { type AnyMachineSnapshot, type AnyStateMachine, getNextTransitions, type StateValue, transition } from 'xstate';
import { z } from 'zod';
import type { AuthUser } from '@/common/auth/auth-user';
import { hasRole } from '@/common/auth/auth-user';
import type { AppAbility, AppSubjectInstance } from '@/common/authz/ability.types';
import { type ActingAs, BACK_OFFICE_ROLE, type ModuleName } from '@/common/domain/vocabulary';
import { ProblemException } from '@/common/http/problem';
import { isZodErrorLike, zodIssuesToFieldErrors } from '@/common/http/zod-errors';
import { PrismaService } from '@/database/prisma.service';
import type { PrismaTx } from '@/database/prisma.types';
import { AuditService } from '../audit/audit.service';
import { stateValueToString } from './state-value';
import type {
  NotifyParams,
  PersistedState,
  TransitionChange,
  TransitionResult,
  WorkflowActionDef,
  WorkflowDefinition,
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

const EMPTY_BODY = z.strictObject({});

/** Default actingAs when an action has no `authorize` hook. */
export function defaultActingAs(user: AuthUser, module: ModuleName): ActingAs {
  if (hasRole(user, 'it_admin')) return 'admin';
  if (module !== 'core' && hasRole(user, BACK_OFFICE_ROLE[module])) return 'back_office';
  return 'self';
}

/**
 * Generic engine behind every `POST /<resource>/{id}/actions/{action}` endpoint (D6/D7):
 * resolves XState snapshots from persisted state, lists the actions a user may take
 * (machine allows AND permission allows), and applies transitions in one transaction with
 * audit row + side effects.
 */
@Injectable()
export class WorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Machine snapshot for a persisted state. */
  snapshotOf(machine: AnyStateMachine, state: PersistedState<unknown>): AnyMachineSnapshot {
    return machine.resolveState({ value: state.value, context: state.context });
  }

  /**
   * Action slugs `actor` can perform on `entity` now, in definition order: the machine
   * accepts the event (guards pass) AND CASL allows it AND `authorize` (if any) agrees.
   */
  async availableActions<TEntity extends object>(
    def: WorkflowDefinition<AnyStateMachine, TEntity>,
    entity: TEntity,
    actor: AuthUser,
    ability: AppAbility,
    db: PrismaTx = this.prisma,
  ): Promise<string[]> {
    const snapshot = this.snapshotOf(def.machine, def.toState(entity));
    const result: string[] = [];
    for (const [slug, action] of Object.entries(def.actions)) {
      if (!snapshot.can({ type: action.event ?? slug, actor, input: undefined })) continue;
      if ((await this.permission(def, slug, action, { tx: db, entity, actor, ability })) !== false) result.push(slug);
    }
    return result;
  }

  /** `{ state, availableActions }` for embedding in API responses. */
  async view<TEntity extends object>(
    def: WorkflowDefinition<AnyStateMachine, TEntity>,
    entity: TEntity,
    actor: AuthUser,
    ability: AppAbility,
  ): Promise<WorkflowView> {
    return {
      state: def.toState(entity).value,
      availableActions: await this.availableActions(def, entity, actor, ability),
    };
  }

  /**
   * Applies an action in one Prisma transaction:
   * load (404) -> permission (403) -> body validation (422) -> machine check (409
   * invalid_transition) -> persist (409 version_conflict) -> audit row -> afterTransition.
   */
  async apply<TEntity extends object>(
    def: WorkflowDefinition<AnyStateMachine, TEntity>,
    params: ApplyTransitionParams,
  ): Promise<TransitionResult<TEntity>> {
    const action = Object.hasOwn(def.actions, params.action) ? def.actions[params.action] : undefined;
    if (!action) throw ProblemException.notFound('Action');

    return this.prisma.$transaction(async (tx) => {
      const entity = await def.load(tx, params.id, params.actor);
      if (!entity) throw ProblemException.notFound();

      const persisted = def.toState(entity);
      const snapshot = this.snapshotOf(def.machine, persisted);
      const eventType = action.event ?? params.action;
      const actingAs = await this.permission(def, params.action, action, {
        tx,
        entity,
        actor: params.actor,
        ability: params.ability,
      });
      // Not permitted -> 403 when the state knows the action at all, else 409 (D5).
      if (actingAs === false) {
        const stateHasAction = getNextTransitions(snapshot).some((t) => t.eventType === eventType);
        throw stateHasAction
          ? ProblemException.forbidden()
          : ProblemException.invalidTransition(params.action, persisted.value);
      }

      const input = this.parseInput(action.input ?? EMPTY_BODY, params.input);
      const event = { type: eventType, actor: params.actor, input };
      if (!snapshot.can(event)) throw ProblemException.invalidTransition(params.action, persisted.value);

      const [next, executed] = transition(def.machine, snapshot, event);
      const toState = stateValueToString(next.value as StateValue);
      const reason =
        typeof input === 'object' && input !== null && typeof (input as { reason?: unknown }).reason === 'string'
          ? (input as { reason: string }).reason
          : null;
      const change: TransitionChange = {
        action: params.action,
        fromState: persisted.value,
        toState,
        actor: params.actor,
        actingAs,
        input,
        reason,
      };

      const updated = await def.persist(tx, entity, { value: toState, context: next.context as unknown }, change);
      if (!updated) throw ProblemException.versionConflict();

      await this.audit.record(
        {
          module: def.module,
          entityType: def.entityType,
          entityId: def.entityId(entity),
          action: params.action,
          actorId: params.actor.id,
          actingAs,
          fromState: persisted.value,
          toState,
          reason,
          entityLabel: def.entityLabel?.(updated),
        },
        tx,
      );

      const notifies = (executed as { type: string; params?: unknown }[])
        .filter((a) => a.type === 'notify' && a.params)
        .map((a) => a.params as NotifyParams);
      await def.afterTransition?.({ tx, before: entity, entity: updated, change, notifies });

      return { entity: updated, fromState: persisted.value, toState, actingAs };
    });
  }

  private async permission<TEntity extends object>(
    def: WorkflowDefinition<AnyStateMachine, TEntity>,
    slug: string,
    action: WorkflowActionDef<TEntity>,
    ctx: { tx: PrismaTx; entity: TEntity; actor: AuthUser; ability: AppAbility },
  ): Promise<ActingAs | false> {
    if (action.ability !== false) {
      const tagged = subject(
        String(def.subjectType),
        ctx.entity as Record<string, unknown>,
      ) as unknown as AppSubjectInstance;
      if (ctx.ability.cannot(action.ability ?? slug, tagged)) return false;
    }
    if (action.authorize) return action.authorize(ctx);
    return action.actingAs ?? defaultActingAs(ctx.actor, def.module);
  }

  private parseInput(schema: z.ZodType, raw: unknown): unknown {
    const result = schema.safeParse(raw ?? {});
    if (!result.success) {
      throw isZodErrorLike(result.error)
        ? ProblemException.validation(zodIssuesToFieldErrors(result.error.issues))
        : ProblemException.validation({ _root: ['Invalid body.'] });
    }
    return result.data;
  }
}
