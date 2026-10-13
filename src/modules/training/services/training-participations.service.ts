import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import type { AppAbility } from '@/common/authz/ability.types';
import type { ActingAs } from '@/common/domain/vocabulary';
import { paginate } from '@/common/http/pagination';
import { ProblemException } from '@/common/http/problem';
import { parseSortOrThrow, toPrismaOrderBy } from '@/common/http/sort';
import { Clock } from '@/common/time/clock.service';
import { addDaysIso, dateFromIso, isoFromDate } from '@/common/time/time';
import { AppConfig } from '@/config/app-config';
import { PrismaService } from '@/database/prisma.service';
import type { Prisma } from '@/generated/prisma/client';
import { AttachmentService } from '@/modules/core/attachments/attachment.service';
import { AuditService } from '@/modules/core/audit/audit.service';
import { WorkflowService } from '@/modules/core/workflow/workflow.service';
import type { ListParticipationsQuery, ParticipationScope } from '../dto/training-request.dto';
import type {
  ParticipationDetailView,
  ParticipationListItemView,
  TrainingAttendeeView,
} from '../dto/training-response.schemas';
import { TrainingAttendeeWorkflow } from '../machines/training-attendee.workflow';
import {
  type AttendeeAction,
  GOALS_EDITABLE_STATUSES,
  HIGH_PRIORITY_STATUSES,
  parseTrainingReference,
} from '../training.constants';
import { TrainingAccess, type TrainingViewer } from './training-access.service';
import { TrainingMapper } from './training-mapper.service';
import { attendeeInclude, type AttendeeRow } from './training.includes';

const PARTICIPATION_SORT: Record<string, string> = {
  startsOn: 'request.startsOn',
  createdAt: 'createdAt',
  status: 'status',
  attendee: 'user.displayName',
};
const APPROVAL_SCOPES: ParticipationScope[] = ['approvals', 'executive', 'deputy'];

/** `/training/participations*` (API.md §4.1) and the attendee DTOs used by requests. */
@Injectable()
export class TrainingParticipationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TrainingAccess,
    private readonly mapper: TrainingMapper,
    private readonly workflow: TrainingAttendeeWorkflow,
    private readonly workflows: WorkflowService,
    private readonly attachments: AttachmentService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
    private readonly clock: Clock,
  ) {}

  // --- Capabilities --------------------------------------------------------------------

  canEditGoals(row: AttendeeRow, viewer: TrainingViewer): boolean {
    return (
      row.userId === viewer.id &&
      (GOALS_EDITABLE_STATUSES as readonly string[]).includes(row.status) &&
      isoFromDate(row.request.startsOn) > viewer.today
    );
  }

  async availableActions(
    row: AttendeeRow,
    user: AuthUser,
    ability: AppAbility,
    viewer: TrainingViewer,
  ): Promise<AttendeeAction[]> {
    const actions = (await this.workflows.availableActions(this.workflow.def, row, user, ability)) as AttendeeAction[];
    if (this.canEditGoals(row, viewer)) actions.push('edit_goals');
    return actions;
  }

  /** The viewer's relation to a pending step (approval scopes, inbox): approver / executive / deputy / chain. */
  relation(row: AttendeeRow, viewer: TrainingViewer): ActingAs | null {
    if (row.status === 'pending_manager_approval' && row.approverId)
      return viewer.canDecide({ kind: 'manager', approverId: row.approverId, subjectId: row.userId }) || null;
    if (row.status === 'pending_executive_approval' && row.executiveApproverId)
      return (
        viewer.canDecide({ kind: 'executive', approverId: row.executiveApproverId, subjectId: row.userId }) || null
      );
    return null;
  }

  // --- Scopes and filters -------------------------------------------------------------

  scopeWhere(scope: ParticipationScope, viewer: TrainingViewer): Prisma.TrainingAttendeeWhereInput {
    const me = viewer.id;
    switch (scope) {
      case 'mine':
        return { userId: me };
      case 'approvals':
        return { status: 'pending_manager_approval', approverId: me, userId: { not: me } };
      case 'executive':
        return { status: 'pending_executive_approval', executiveApproverId: me, userId: { not: me } };
      case 'deputy':
        if (viewer.principals.length === 0) return { id: { in: [] } };
        return {
          userId: { not: me },
          OR: [
            { status: 'pending_manager_approval', approverId: { in: viewer.principals } },
            { status: 'pending_executive_approval', executiveApproverId: { in: viewer.principals } },
          ],
        };
      case 'team':
        return viewer.treeIds.length ? { userId: { in: viewer.treeIds } } : { id: { in: [] } };
      case 'all':
        if (!viewer.isBackOffice)
          throw ProblemException.forbidden('Only the training office can list all participations.');
        return {};
    }
  }

  filterWhere(query: Omit<ListParticipationsQuery, 'page' | 'perPage' | 'scope' | 'sort'>, viewer: TrainingViewer) {
    const and: Prisma.TrainingAttendeeWhereInput[] = [];
    if (query.status) and.push({ status: { in: query.status } });
    if (query.requestId) and.push({ requestId: query.requestId });
    if (query.from) and.push({ request: { startsOn: { gte: dateFromIso(query.from) } } });
    if (query.to) and.push({ request: { startsOn: { lte: dateFromIso(query.to) } } });
    if (query.q) {
      const num = parseTrainingReference(query.q);
      and.push(
        num !== null
          ? { request: { number: num } }
          : {
              OR: [
                { request: { topic: { contains: query.q, mode: 'insensitive' } } },
                { request: { provider: { contains: query.q, mode: 'insensitive' } } },
                { user: { displayName: { contains: query.q, mode: 'insensitive' } } },
              ],
            },
      );
    }
    if (query.highPriority !== undefined) {
      const high: Prisma.TrainingAttendeeWhereInput = {
        status: { in: [...HIGH_PRIORITY_STATUSES] },
        request: {
          startsOn: {
            gte: dateFromIso(viewer.today),
            lte: dateFromIso(addDaysIso(viewer.today, this.config.get('TRAINING_HIGH_PRIORITY_DAYS'))),
          },
        },
      };
      and.push(query.highPriority ? high : { NOT: high });
    }
    return and;
  }

  orderBy(scope: ParticipationScope, sort: string | undefined): Prisma.TrainingAttendeeOrderByWithRelationInput[] {
    const fields = parseSortOrThrow(
      sort ?? (APPROVAL_SCOPES.includes(scope) ? 'startsOn' : '-createdAt'),
      Object.keys(PARTICIPATION_SORT),
    );
    return [
      ...(toPrismaOrderBy(fields, PARTICIPATION_SORT) as Prisma.TrainingAttendeeOrderByWithRelationInput[]),
      { id: 'asc' },
    ];
  }

  // --- Lists ---------------------------------------------------------------------------

  async list(user: AuthUser, ability: AppAbility, query: ListParticipationsQuery) {
    const viewer = await this.access.viewer(user, ability);
    const where: Prisma.TrainingAttendeeWhereInput = {
      AND: [this.scopeWhere(query.scope, viewer), ...this.filterWhere(query, viewer)],
    };
    const orderBy = this.orderBy(query.scope, query.sort);
    return paginate<ParticipationListItemView>(
      query,
      async (page) => {
        const rows = await this.prisma.trainingAttendee.findMany({ where, orderBy, include: attendeeInclude, ...page });
        const items: ParticipationListItemView[] = [];
        for (const row of rows) {
          const actingAs =
            query.scope === 'approvals'
              ? 'approver'
              : query.scope === 'executive'
                ? 'executive'
                : query.scope === 'deputy'
                  ? 'deputy'
                  : query.scope === 'team'
                    ? this.relation(row, viewer)
                    : null;
          items.push(
            this.mapper.listItem(row, actingAs, await this.availableActions(row, user, ability, viewer), viewer),
          );
        }
        return items;
      },
      () => this.prisma.trainingAttendee.count({ where }),
    );
  }

  /** Rows for CSV export (scope all, list filters, max 5000). */
  async exportRows(
    user: AuthUser,
    ability: AppAbility,
    query: Omit<ListParticipationsQuery, 'page' | 'perPage' | 'scope'>,
  ) {
    const viewer = await this.access.viewer(user, ability);
    if (!viewer.isBackOffice) throw ProblemException.forbidden('Only the training office can export participations.');
    return this.prisma.trainingAttendee.findMany({
      where: { AND: this.filterWhere(query, viewer) },
      orderBy: this.orderBy('all', query.sort),
      include: attendeeInclude,
      take: 5000,
    });
  }

  // --- Detail --------------------------------------------------------------------------

  async findVisible(id: string, viewer: TrainingViewer): Promise<AttendeeRow> {
    const row = await this.prisma.trainingAttendee.findFirst({
      where: { id, ...viewer.attendeeWhere() },
      include: attendeeInclude,
    });
    if (!row) throw ProblemException.notFound('Participation');
    return row;
  }

  async attendeeDto(id: string, user: AuthUser, ability: AppAbility): Promise<TrainingAttendeeView> {
    const viewer = await this.access.viewer(user, ability);
    const row = await this.findVisible(id, viewer);
    const docs = await this.mapper.bookingDocuments([row.id]);
    return this.mapper.attendee(row, await this.availableActions(row, user, ability, viewer), docs.get(row.id) ?? []);
  }

  /** Attendee rows of a request the viewer may see (request detail). */
  async attendeesOf(
    requestId: string,
    user: AuthUser,
    ability: AppAbility,
    viewer: TrainingViewer,
  ): Promise<TrainingAttendeeView[]> {
    const rows = await this.prisma.trainingAttendee.findMany({
      where: { requestId, ...viewer.attendeeWhere() },
      include: attendeeInclude,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const docs = await this.mapper.bookingDocuments(rows.map((r) => r.id));
    const result: TrainingAttendeeView[] = [];
    for (const row of rows) {
      result.push(
        this.mapper.attendee(row, await this.availableActions(row, user, ability, viewer), docs.get(row.id) ?? []),
      );
    }
    return result;
  }

  async detail(id: string, user: AuthUser, ability: AppAbility): Promise<ParticipationDetailView> {
    const viewer = await this.access.viewer(user, ability);
    const row = await this.findVisible(id, viewer);
    const docs = await this.mapper.bookingDocuments([row.id]);
    const attendee = this.mapper.attendee(
      row,
      await this.availableActions(row, user, ability, viewer),
      docs.get(row.id) ?? [],
    );
    const request = row.request;
    return {
      ...attendee,
      request: {
        ...this.mapper.requestSummary(request, viewer),
        registrationUrl: request.registrationUrl,
        registrationDetails: request.registrationDetails,
        certificateExpected: request.certificateExpected,
        reimbursementAgreement: request.reimbursementAgreement,
        requesterComment: request.requesterComment,
        attachments: await this.attachments.listFor('training_request', request.id),
      },
    };
  }

  /** `POST /training/participations/{id}/actions/{action}` -> 200 + detail. */
  async act(id: string, action: string, body: unknown, user: AuthUser, ability: AppAbility) {
    await this.workflows.apply(this.workflow.def, { id, action, actor: user, ability, input: body });
    return this.detail(id, user, ability);
  }

  // --- Goals and timeline ---------------------------------------------------------------

  async putGoals(
    id: string,
    user: AuthUser,
    ability: AppAbility,
    body: { goal1: string | null; goal2: string | null },
  ): Promise<ParticipationDetailView> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM training_attendees WHERE id = ${id}::uuid FOR UPDATE`;
      const viewer = await this.access.viewer(user, undefined, tx);
      const row = await tx.trainingAttendee.findFirst({
        where: { id, ...viewer.attendeeWhere() },
        include: attendeeInclude,
      });
      if (!row) throw ProblemException.notFound('Participation');
      if (row.userId !== user.id) throw ProblemException.forbidden('Only the attendee can set the learning goals.');
      if (!this.canEditGoals(row, viewer))
        throw ProblemException.conflict(
          'Learning goals can only be changed until the training starts.',
          'invalid_transition',
        );
      const changes = this.audit.diff('training_attendee', row, body, ['goal1', 'goal2']);
      await tx.trainingAttendee.update({
        where: { id },
        data: { goal1: body.goal1, goal2: body.goal2, goalsUpdatedAt: this.clock.now(), version: { increment: 1 } },
      });
      if (changes.length) {
        await this.audit.record(
          {
            module: 'training',
            entityType: 'training_attendee',
            entityId: id,
            action: 'update_goals',
            actorId: user.id,
            actingAs: 'self',
            changes,
            entityLabel: row.user.displayName,
          },
          tx,
        );
      }
    });
    return this.detail(id, user, ability);
  }

  async timeline(id: string, user: AuthUser, ability: AppAbility) {
    const viewer = await this.access.viewer(user, ability);
    const row = await this.findVisible(id, viewer);
    // Loop-3 (manager's view) entries stay hidden from the attendee.
    const ratings = row.ratings.filter((r) => r.loop !== 3 || row.userId !== viewer.id || viewer.isBackOffice);
    const loops = new Map(ratings.map((r) => [r.id, r.loop]));
    return this.audit.timeline(
      [
        { entityType: 'training_attendee', entityId: id },
        ...ratings.map((r) => ({ entityType: 'training_rating', entityId: r.id })),
      ],
      (e) =>
        e.entityType === 'training_rating' ? `Feedback round ${loops.get(e.entityId) ?? ''}` : row.user.displayName,
    );
  }
}
