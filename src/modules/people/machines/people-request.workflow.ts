import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import { Clock } from '@/common/time/clock.service';
import { AppConfig } from '@/config/app-config';
import type { PrismaTx } from '@/database/prisma.types';
import type { Prisma } from '@/generated/prisma/client';
import { defaultActingAs, defineWorkflow, lockRow, type TransitionChange } from '@/modules/core/workflow';
import { optionalNoteBody, questionBody, reasonBody, replyBody, requiredNoteBody } from '../dto/people-request.dto';
import { isPeopleBackOffice, peopleReference, type PeopleCommentKind } from '../people.constants';
import { canView, peopleRequestInclude, type PeopleRequestRow } from '../services/people-access';
import { PeopleNotifier } from '../services/people-notifier.service';
import { peopleRequestMachine } from './people-request.machine';

const DAY_MS = 86_400_000;

/** Note / question / reply carried by an action body. */
interface ActionInput {
  note?: string | null;
  question?: string;
  reason?: string;
  body?: string;
}

/** Comment written by an action: `wait_internal` notes are internal, the others public. */
const ACTION_COMMENTS: Partial<
  Record<string, { field: keyof ActionInput; internal: boolean; kind: PeopleCommentKind }>
> = {
  start_work: { field: 'note', internal: false, kind: 'status_note' },
  wait_internal: { field: 'note', internal: true, kind: 'status_note' },
  wait_on_requester: { field: 'question', internal: false, kind: 'question' },
  resume: { field: 'note', internal: false, kind: 'status_note' },
  complete: { field: 'note', internal: false, kind: 'status_note' },
  requester_replied: { field: 'body', internal: false, kind: 'comment' },
};

/**
 * The `people_request` workflow (SPEC §5.4) bound to the `people_requests` table.
 * `definition` serves `POST /people/requests/{id}/actions/{action}`; `replyDefinition`
 * holds the system event `requester_replied`, fired by a requester's public comment while
 * the request waits on them (it is never an HTTP action).
 */
@Injectable()
export class PeopleRequestWorkflow {
  readonly definition;
  readonly replyDefinition;

  constructor(
    private readonly notifier: PeopleNotifier,
    private readonly clock: Clock,
    private readonly config: AppConfig,
  ) {
    const base = {
      name: 'people_request',
      module: 'people' as const,
      entityType: 'people_request',
      subjectType: 'PeopleRequest',
      machine: peopleRequestMachine,
      entityId: (row: PeopleRequestRow) => row.id,
      entityLabel: (row: PeopleRequestRow) => `${peopleReference(row.number)} ${row.title}`,
      toState: (row: PeopleRequestRow) => ({ value: row.status, context: { requesterId: row.requesterId } }),
      load: async (tx: PrismaTx, id: string, actor: AuthUser) => {
        if (!(await lockRow(tx, 'people_requests', id))) return null;
        const row = await tx.peopleRequest.findUnique({ where: { id }, include: peopleRequestInclude });
        return row && canView(actor, row) ? row : null;
      },
      persist: (tx: PrismaTx, row: PeopleRequestRow, next: { value: string }, change: TransitionChange) =>
        this.persist(tx, row, next.value, change),
      afterTransition: ({ tx, entity, change }: { tx: PrismaTx; entity: PeopleRequestRow; change: TransitionChange }) =>
        this.afterTransition(tx, entity, change),
    };

    this.definition = defineWorkflow({
      ...base,
      actions: {
        start_work: { input: optionalNoteBody },
        wait_internal: { input: requiredNoteBody },
        wait_on_requester: { input: questionBody },
        resume: { input: optionalNoteBody },
        complete: { input: optionalNoteBody },
        reject: { input: reasonBody },
        cancel: {
          ability: false,
          input: reasonBody,
          authorize: ({ entity, actor }) => {
            if (isPeopleBackOffice(actor)) return defaultActingAs(actor, 'people');
            return entity.requesterId === actor.id ? 'requester' : false;
          },
        },
        reopen: {
          ability: false,
          input: reasonBody,
          authorize: ({ entity, actor }) => {
            if (isPeopleBackOffice(actor)) return defaultActingAs(actor, 'people');
            // The requester may reopen a completed request within PEOPLE_REOPEN_WINDOW_DAYS.
            if (entity.requesterId !== actor.id || entity.status !== 'completed' || !entity.closedAt) return false;
            const windowMs = this.config.get('PEOPLE_REOPEN_WINDOW_DAYS') * DAY_MS;
            return this.clock.now().getTime() - entity.closedAt.getTime() <= windowMs ? 'requester' : false;
          },
        },
      },
    });

    this.replyDefinition = defineWorkflow({
      ...base,
      actions: {
        requester_replied: {
          ability: false,
          input: replyBody,
          authorize: ({ entity, actor }) => (entity.requesterId === actor.id ? 'requester' : false),
        },
      },
    });
  }

  private async persist(
    tx: PrismaTx,
    row: PeopleRequestRow,
    status: string,
    change: TransitionChange,
  ): Promise<PeopleRequestRow | null> {
    const now = this.clock.now();
    const data: Prisma.PeopleRequestUncheckedUpdateManyInput = {
      status: status as PeopleRequestRow['status'],
      version: { increment: 1 },
    };
    switch (change.action) {
      case 'start_work':
        if (!row.assigneeId) data.assigneeId = change.actor.id;
        break;
      case 'complete':
        data.closedAt = now;
        break;
      case 'reject':
      case 'cancel':
        data.closedAt = now;
        data.statusReason = change.reason;
        break;
      case 'reopen':
        data.closedAt = null;
        data.statusReason = change.reason;
        break;
    }
    const result = await tx.peopleRequest.updateMany({ where: { id: row.id, version: row.version }, data });
    if (result.count === 0) return null;
    return tx.peopleRequest.findUniqueOrThrow({ where: { id: row.id }, include: peopleRequestInclude });
  }

  private async afterTransition(tx: PrismaTx, row: PeopleRequestRow, change: TransitionChange): Promise<void> {
    const input = (change.input ?? {}) as ActionInput;
    const comment = ACTION_COMMENTS[change.action];
    const text = comment ? input[comment.field] : null;
    if (comment && typeof text === 'string' && text.trim()) {
      await tx.peopleRequestComment.create({
        data: {
          requestId: row.id,
          authorId: change.actor.id,
          body: text.trim(),
          internal: comment.internal,
          kind: comment.kind,
          createdAt: this.clock.now(),
        },
      });
    }

    if (change.action === 'requester_replied') {
      await this.notifier.commentAdded(tx, row, change.actor, input.body ?? '');
      return;
    }
    await this.notifier.statusChanged(tx, row, change.actor, {
      question: change.action === 'wait_on_requester' ? (input.question ?? null) : null,
      reason: change.reason,
      // wait_internal notes are internal: never mailed (SPEC_RESOLUTIONS #19).
      note: comment && !comment.internal && comment.field === 'note' ? (input.note ?? null) : null,
    });
  }
}
