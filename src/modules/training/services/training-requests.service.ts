import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import { money, toUserRef, toUserRefOrNull } from '@/common/domain/mappers';
import type { ActingAs } from '@/common/domain/vocabulary';
import type { AppAbility } from '@/common/authz/ability.types';
import { paginate } from '@/common/http/pagination';
import { type FieldErrors, ProblemException } from '@/common/http/problem';
import { toPrismaOrderBy } from '@/common/http/sort';
import { Clock } from '@/common/time/clock.service';
import { dateFromIso, isoFromDate } from '@/common/time/time';
import { AppConfig } from '@/config/app-config';
import { PrismaService } from '@/database/prisma.service';
import type { PrismaTx } from '@/database/prisma.types';
import type { Prisma } from '@/generated/prisma/client';
import { activeDeputiesOf } from '@/modules/core/approvals/approval-rules';
import { AttachmentService } from '@/modules/core/attachments/attachment.service';
import { AuditService } from '@/modules/core/audit/audit.service';
import type {
  AttendeeInput,
  CreateTrainingRequest,
  ListRequestsQuery,
  TrainingPreviewRequest,
  UpdateBackOffice,
  UpdateTrainingRequest,
} from '../dto/training-request.dto';
import type {
  TrainingAttendeeView,
  TrainingPreviewView,
  TrainingRequestDetailView,
} from '../dto/training-response.schemas';
import { formatMoney, parseTrainingReference, type RequestAction, trainingReference } from '../training.constants';
import { TrainingAccess, type TrainingViewer } from './training-access.service';
import { TrainingEntryService } from './training-entry.service';
import { TrainingMapper } from './training-mapper.service';
import { TrainingParticipationsService } from './training-participations.service';
import { requestCoreInclude, type RequestCoreRow } from './training.includes';

const REQUEST_SORT: Record<string, string> = {
  startsOn: 'startsOn',
  createdAt: 'createdAt',
  topic: 'topic',
  cost: 'costCents',
};

/** `/training/requests*` (API.md §4.1). */
@Injectable()
export class TrainingRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TrainingAccess,
    private readonly mapper: TrainingMapper,
    private readonly entry: TrainingEntryService,
    private readonly participations: TrainingParticipationsService,
    private readonly attachments: AttachmentService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
    private readonly clock: Clock,
  ) {}

  // --- Lists ---------------------------------------------------------------------------

  async list(user: AuthUser, ability: AppAbility, query: ListRequestsQuery) {
    const viewer = await this.access.viewer(user, ability);
    if (query.scope === 'all' && !viewer.isBackOffice)
      throw ProblemException.forbidden('Only the training office can list all requests.');
    const and: Prisma.TrainingRequestWhereInput[] = [query.scope === 'all' ? {} : { requesterId: user.id }];
    if (query.q) {
      const num = parseTrainingReference(query.q);
      and.push(
        num !== null
          ? { number: num }
          : {
              OR: [
                { topic: { contains: query.q, mode: 'insensitive' } },
                { provider: { contains: query.q, mode: 'insensitive' } },
              ],
            },
      );
    }
    if (query.from) and.push({ startsOn: { gte: dateFromIso(query.from) } });
    if (query.to) and.push({ startsOn: { lte: dateFromIso(query.to) } });
    if (query.billingStatus) and.push({ billingStatus: { in: query.billingStatus } });
    if (query.attendeeStatus) and.push({ attendees: { some: { status: { in: query.attendeeStatus } } } });
    const where: Prisma.TrainingRequestWhereInput = { AND: and };
    const orderBy = [
      ...toPrismaOrderBy(query.sort, REQUEST_SORT),
      { id: 'desc' },
    ] as Prisma.TrainingRequestOrderByWithRelationInput[];
    return paginate(
      query,
      async (page) =>
        (await this.prisma.trainingRequest.findMany({ where, orderBy, include: requestCoreInclude, ...page })).map(
          (r) => this.mapper.requestSummary(r, viewer),
        ),
      () => this.prisma.trainingRequest.count({ where }),
    );
  }

  // --- Detail --------------------------------------------------------------------------

  private async findVisible(id: string, viewer: TrainingViewer, db: PrismaTx = this.prisma): Promise<RequestCoreRow> {
    const row = await db.trainingRequest.findFirst({
      where: { id, ...viewer.requestWhere() },
      include: requestCoreInclude,
    });
    if (!row) throw ProblemException.notFound('Training request');
    return row;
  }

  private isRequester(row: { requesterId: string }, user: AuthUser): boolean {
    return row.requesterId === user.id;
  }

  /** No attendee has passed the manager step yet (cost-edit window, SPEC §3.1 / SPEC_RESOLUTIONS #28). */
  private async costWindowOpen(requestId: string, db: PrismaTx = this.prisma): Promise<boolean> {
    return (await db.trainingAttendee.count({ where: { requestId, managerDecisionAt: { not: null } } })) === 0;
  }

  requestActions(row: RequestCoreRow, viewer: TrainingViewer): RequestAction[] {
    const actions: RequestAction[] = [];
    const requester = this.isRequester(row, viewer.user);
    const allPending = row.attendees.every((a) => a.status === 'pending_manager_approval');
    if (viewer.isBackOffice || (requester && allPending)) actions.push('edit');
    if (viewer.isBackOffice) actions.push('edit_back_office');
    if ((requester || viewer.isBackOffice) && isoFromDate(row.startsOn) > viewer.today) actions.push('add_attendee');
    if (requester || viewer.isBackOffice) actions.push('add_attachment');
    return actions;
  }

  async detail(id: string, user: AuthUser, ability: AppAbility): Promise<TrainingRequestDetailView> {
    const viewer = await this.access.viewer(user, ability);
    const row = await this.findVisible(id, viewer);
    const attendees = await this.participations.attendeesOf(id, user, ability, viewer);
    return {
      ...this.mapper.requestSummary(row, viewer),
      registrationUrl: row.registrationUrl,
      registrationDetails: row.registrationDetails,
      costCenter: { id: row.costCenter.id, code: row.costCenter.code, name: row.costCenter.name },
      executiveApprover: toUserRefOrNull(row.executiveApprover),
      certificateExpected: row.certificateExpected,
      reimbursementAgreement: row.reimbursementAgreement,
      requesterComment: row.requesterComment,
      backOffice: viewer.isBackOffice
        ? {
            comment: row.backOfficeComment,
            billingStatus: row.billingStatus,
            actualCost: row.actualCostCents !== null ? money(row.actualCostCents) : null,
          }
        : null,
      attachments: await this.attachments.listFor('training_request', id),
      attendees,
      availableActions: this.requestActions(row, viewer),
      version: row.version,
    };
  }

  // --- Preview -------------------------------------------------------------------------

  async preview(user: AuthUser, ability: AppAbility, body: TrainingPreviewRequest): Promise<TrainingPreviewView> {
    const viewer = await this.access.viewer(user, ability);
    const threshold = this.config.get('TRAINING_EXECUTIVE_THRESHOLD_CENTS');
    const executiveStepRequired = (body.cost?.amountCents ?? 0) >= threshold;
    const executives = viewer.org
      .all()
      .filter((u) => u.isExecutive && u.active)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
    const errors: FieldErrors = {};
    body.attendees.forEach((a, i) => {
      if (!viewer.org.get(a.userId)) errors[`attendees.${i}.userId`] = ['This person does not exist.'];
    });
    let executiveApproverId: string | null = null;
    if (executiveStepRequired && body.executiveApproverId) {
      if (!executives.some((e) => e.id === body.executiveApproverId)) {
        errors.executiveApproverId = ['Pick an active executive.'];
      } else executiveApproverId = body.executiveApproverId;
    }
    if (Object.keys(errors).length) throw ProblemException.validation(errors);

    const attendees = body.attendees.map(({ userId }) => {
      const subject = viewer.org.require(userId);
      // Required but not chosen yet: plan with a placeholder executive (never the requester).
      const execForPlan = executiveStepRequired
        ? (executiveApproverId ?? '00000000-0000-0000-0000-000000000000')
        : null;
      const plan = this.entry.plan(viewer.org, userId, user.id, execForPlan);
      const allowed = subject.active && viewer.mayActFor(userId);
      const approver = plan.resolution.approver;
      return {
        user: toUserRef(subject),
        approver: toUserRef(approver),
        approverReason: plan.resolution.reason,
        escalatedFrom: toUserRefOrNull(viewer.org.get(plan.resolution.escalatedFromId)),
        autoApproval: plan.managerAuto,
        activeDeputies: activeDeputiesOf(viewer.org, approver.id, viewer.today).map((d) => toUserRef(d)),
        allowed,
        notAllowedReason: !subject.active
          ? `${subject.displayName} is no longer active.`
          : allowed
            ? null
            : 'You can only request for yourself or your team',
        initialState: plan.initialState,
        executiveAutoApproval: plan.executiveAuto,
      };
    });
    return {
      executiveStepRequired,
      threshold: money(threshold),
      executiveCandidates: executives.map((e) => toUserRef(e)),
      executiveApprover: toUserRefOrNull(viewer.org.get(executiveApproverId)),
      attendees,
    };
  }

  // --- Create --------------------------------------------------------------------------

  private async validateRequestFields(
    tx: PrismaTx,
    viewer: TrainingViewer,
    fields: {
      format: string;
      location: string | null;
      startsOn: string;
      endsOn: string;
      costCents: number;
      costCenterId: string | null;
      executiveApproverId: string | null;
    },
    checkStart: boolean,
  ): Promise<FieldErrors> {
    const errors: FieldErrors = {};
    if (fields.format !== 'online' && !fields.location) errors.location = ['Add the location (or choose Online).'];
    if (checkStart && !viewer.isBackOffice && fields.startsOn < viewer.today)
      errors.startsOn = ['The training starts in the past. Pick today or a later date.'];
    if (fields.endsOn < fields.startsOn) errors.endsOn = ['The end date is before the start date.'];
    if (fields.costCenterId) {
      const cc = await tx.costCenter.findUnique({ where: { id: fields.costCenterId } });
      if (!cc || !cc.active) errors.costCenterId = ['Pick an active cost centre.'];
    }
    const threshold = this.config.get('TRAINING_EXECUTIVE_THRESHOLD_CENTS');
    if (fields.costCents >= threshold) {
      const exec = fields.executiveApproverId ? viewer.org.get(fields.executiveApproverId) : undefined;
      if (!fields.executiveApproverId)
        errors.executiveApproverId = [
          `Trainings from ${formatMoney(threshold)} per attendee need an executive approver.`,
        ];
      else if (!exec || !exec.active || !exec.isExecutive) errors.executiveApproverId = ['Pick an active executive.'];
    } else if (fields.executiveApproverId) {
      errors.executiveApproverId = ['An executive approver is only needed from the threshold. Remove it.'];
    }
    return errors;
  }

  private creatorActingAs(user: AuthUser, viewer: TrainingViewer, attendeeId: string): ActingAs {
    if (attendeeId === user.id) return 'self';
    if (viewer.isBackOffice && !viewer.isInTree(attendeeId)) return viewer.isTrainingOffice ? 'back_office' : 'admin';
    return 'requester';
  }

  async create(user: AuthUser, ability: AppAbility, body: CreateTrainingRequest): Promise<TrainingRequestDetailView> {
    const id = await this.prisma.$transaction(async (tx) => {
      const viewer = await this.access.viewer(user, undefined, tx);
      const errors: FieldErrors = {
        ...(await this.validateRequestFields(tx, viewer, { ...body, costCents: body.cost.amountCents }, true)),
        ...(await this.entry.validateAttendees(tx, body.attendees, viewer, body)),
      };
      if (Object.keys(errors).length) throw ProblemException.validation(errors);

      const me = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { costCenterId: true } });
      const request = await tx.trainingRequest.create({
        data: {
          topic: body.topic,
          provider: body.provider,
          format: body.format,
          location: body.location,
          registrationUrl: body.registrationUrl,
          registrationDetails: body.registrationDetails,
          startsOn: dateFromIso(body.startsOn),
          endsOn: dateFromIso(body.endsOn),
          costCents: body.cost.amountCents,
          costCenterId: body.costCenterId ?? me.costCenterId,
          executiveApproverId: body.executiveApproverId,
          certificateExpected: body.certificateExpected,
          reimbursementAgreement: body.reimbursementAgreement,
          requesterComment: body.requesterComment,
          requesterId: user.id,
        },
      });
      await this.audit.record(
        {
          module: 'training',
          entityType: 'training_request',
          entityId: request.id,
          action: 'create',
          actorId: user.id,
          actingAs: viewer.isBackOffice ? (viewer.isTrainingOffice ? 'back_office' : 'admin') : 'requester',
          entityLabel: trainingReference(request.number),
          metadata: { attendees: body.attendees.length },
        },
        tx,
      );
      await this.attachments.link(tx, {
        ids: body.attachmentIds,
        entityType: 'training_request',
        entityId: request.id,
        purposes: ['training_document'],
        actor: user,
      });
      for (const input of body.attendees) {
        await this.entry.create(tx, {
          requestId: request.id,
          input,
          requester: user,
          viewer,
          executiveApproverId: body.executiveApproverId,
          actingAs: this.creatorActingAs(user, viewer, input.userId),
        });
      }
      return request.id;
    });
    return this.detail(id, user, ability);
  }

  // --- Edit ----------------------------------------------------------------------------

  async update(
    id: string,
    user: AuthUser,
    ability: AppAbility,
    body: UpdateTrainingRequest,
  ): Promise<TrainingRequestDetailView> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM training_requests WHERE id = ${id}::uuid FOR UPDATE`;
      const viewer = await this.access.viewer(user, undefined, tx);
      const row = await this.findVisible(id, viewer, tx);
      const requester = this.isRequester(row, user);
      if (!requester && !viewer.isBackOffice)
        throw ProblemException.forbidden('Only the requester or the training office can edit this request.');
      if (body.version !== undefined && body.version !== row.version) throw ProblemException.versionConflict();
      if (!viewer.isBackOffice && !row.attendees.every((a) => a.status === 'pending_manager_approval')) {
        throw ProblemException.conflict(
          'The request can no longer be edited: at least one attendee has passed the manager approval.',
        );
      }
      const changesCost = body.cost !== undefined && body.cost.amountCents !== row.costCents;
      const changesExec =
        body.executiveApproverId !== undefined && (body.executiveApproverId ?? null) !== row.executiveApproverId;
      const threshold = this.config.get('TRAINING_EXECUTIVE_THRESHOLD_CENTS');
      const costCents = body.cost?.amountCents ?? row.costCents;
      // Below the threshold the executive approver is cleared automatically when not given.
      let executiveApproverId =
        body.executiveApproverId !== undefined ? (body.executiveApproverId ?? null) : row.executiveApproverId;
      if (costCents < threshold && body.executiveApproverId === undefined) executiveApproverId = null;
      const execChanges = changesExec || executiveApproverId !== row.executiveApproverId;
      if ((changesCost || execChanges) && !(await this.costWindowOpen(id, tx))) {
        throw ProblemException.conflict(
          'The cost and the executive approver can only change until the first attendee passes the manager approval.',
        );
      }
      const next = {
        topic: body.topic ?? row.topic,
        provider: body.provider ?? row.provider,
        format: body.format ?? row.format,
        location: body.location !== undefined ? body.location : row.location,
        registrationUrl: body.registrationUrl !== undefined ? body.registrationUrl : row.registrationUrl,
        registrationDetails:
          body.registrationDetails !== undefined ? body.registrationDetails : row.registrationDetails,
        startsOn: body.startsOn ?? isoFromDate(row.startsOn),
        endsOn: body.endsOn ?? isoFromDate(row.endsOn),
        costCents,
        costCenterId: body.costCenterId ?? row.costCenterId,
        executiveApproverId,
        certificateExpected: body.certificateExpected ?? row.certificateExpected,
        reimbursementAgreement: body.reimbursementAgreement ?? row.reimbursementAgreement,
        requesterComment: body.requesterComment !== undefined ? body.requesterComment : row.requesterComment,
      };
      const errors = await this.validateRequestFields(
        tx,
        viewer,
        next,
        body.startsOn !== undefined && body.startsOn !== isoFromDate(row.startsOn),
      );
      if (Object.keys(errors).length) throw ProblemException.validation(errors);

      const before = {
        ...row,
        startsOn: isoFromDate(row.startsOn),
        endsOn: isoFromDate(row.endsOn),
      } as unknown as Record<string, unknown>;
      const changes = this.audit.diff('training_request', before, next, [
        'topic',
        'provider',
        'format',
        'location',
        'registrationUrl',
        'registrationDetails',
        'startsOn',
        'endsOn',
        'costCents',
        'costCenterId',
        'executiveApproverId',
        'certificateExpected',
        'reimbursementAgreement',
        'requesterComment',
      ]);
      const updated = await tx.trainingRequest.updateMany({
        where: { id, version: row.version },
        data: {
          ...next,
          format: next.format,
          startsOn: dateFromIso(next.startsOn),
          endsOn: dateFromIso(next.endsOn),
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) throw ProblemException.versionConflict();
      if (execChanges || changesCost) {
        await tx.trainingAttendee.updateMany({
          where: { requestId: id, status: 'pending_manager_approval' },
          data: { executiveApproverId, version: { increment: 1 } },
        });
      }
      if (changes.length) {
        await this.audit.record(
          {
            module: 'training',
            entityType: 'training_request',
            entityId: id,
            action: 'update',
            actorId: user.id,
            actingAs: requester ? 'requester' : viewer.isTrainingOffice ? 'back_office' : 'admin',
            changes,
            entityLabel: trainingReference(row.number),
          },
          tx,
        );
      }
    });
    return this.detail(id, user, ability);
  }

  async updateBackOffice(
    id: string,
    user: AuthUser,
    ability: AppAbility,
    body: UpdateBackOffice,
  ): Promise<TrainingRequestDetailView> {
    await this.prisma.$transaction(async (tx) => {
      const viewer = await this.access.viewer(user, undefined, tx);
      const row = await this.findVisible(id, viewer, tx);
      if (!viewer.isBackOffice)
        throw ProblemException.forbidden('Only the training office can edit the billing details.');
      if (body.version !== undefined && body.version !== row.version) throw ProblemException.versionConflict();
      const billingStatus = body.billingStatus ?? row.billingStatus;
      let actualCostCents =
        body.actualCost !== undefined ? (body.actualCost?.amountCents ?? null) : row.actualCostCents;
      // SPEC §6.4: free_of_charge forces the actual cost to 0.
      if (billingStatus === 'free_of_charge') actualCostCents = 0;
      const next = {
        billingStatus,
        actualCostCents,
        backOfficeComment: body.backOfficeComment !== undefined ? body.backOfficeComment : row.backOfficeComment,
      };
      const changes = this.audit.diff('training_request', row, next, [
        'billingStatus',
        'actualCostCents',
        'backOfficeComment',
      ]);
      const updated = await tx.trainingRequest.updateMany({
        where: { id, version: row.version },
        data: { ...next, version: { increment: 1 } },
      });
      if (updated.count === 0) throw ProblemException.versionConflict();
      if (changes.length) {
        await this.audit.record(
          {
            module: 'training',
            entityType: 'training_request',
            entityId: id,
            action: 'update_back_office',
            actorId: user.id,
            actingAs: viewer.isTrainingOffice ? 'back_office' : 'admin',
            changes,
            entityLabel: trainingReference(row.number),
          },
          tx,
        );
      }
    });
    return this.detail(id, user, ability);
  }

  // --- Attendees and documents ---------------------------------------------------------

  async addAttendee(
    id: string,
    user: AuthUser,
    ability: AppAbility,
    input: AttendeeInput,
  ): Promise<TrainingAttendeeView> {
    const attendeeId = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM training_requests WHERE id = ${id}::uuid FOR UPDATE`;
      const viewer = await this.access.viewer(user, undefined, tx);
      const row = await this.findVisible(id, viewer, tx);
      if (!this.isRequester(row, user) && !viewer.isBackOffice)
        throw ProblemException.forbidden('Only the requester or the training office can add attendees.');
      if (isoFromDate(row.startsOn) <= viewer.today)
        throw ProblemException.conflict('Attendees can only be added before the training starts.');
      if (await tx.trainingAttendee.findFirst({ where: { requestId: id, userId: input.userId } }))
        throw ProblemException.conflict('This person is already an attendee of the request.');
      const errors = await this.entry.validateAttendees(
        tx,
        [input],
        viewer,
        { startsOn: isoFromDate(row.startsOn), endsOn: isoFromDate(row.endsOn) },
        '',
        false,
      );
      if (Object.keys(errors).length) throw ProblemException.validation(errors);
      const created = await this.entry.create(tx, {
        requestId: id,
        input,
        requester: user,
        viewer,
        executiveApproverId: row.executiveApproverId,
        actingAs: this.creatorActingAs(user, viewer, input.userId),
      });
      await this.audit.record(
        {
          module: 'training',
          entityType: 'training_request',
          entityId: id,
          action: 'add_attendee',
          actorId: user.id,
          actingAs: this.isRequester(row, user) ? 'requester' : viewer.isTrainingOffice ? 'back_office' : 'admin',
          metadata: { attendeeId: created.id, attendeeName: created.user.displayName },
          entityLabel: trainingReference(row.number),
        },
        tx,
      );
      return created.id;
    });
    return this.participations.attendeeDto(attendeeId, user, ability);
  }

  async addAttachments(id: string, user: AuthUser, ability: AppAbility, attachmentIds: string[]) {
    await this.prisma.$transaction(async (tx) => {
      const viewer = await this.access.viewer(user, ability);
      const row = await this.findVisible(id, viewer, tx);
      if (!this.isRequester(row, user) && !viewer.isBackOffice)
        throw ProblemException.forbidden('Only the requester or the training office can add documents.');
      const existing = await tx.attachment.count({
        where: { entityType: 'training_request', entityId: id, deletedAt: null },
      });
      if (existing + attachmentIds.length > 10)
        throw ProblemException.fieldError('attachmentIds', 'A request can hold at most 10 documents.');
      await this.attachments.link(tx, {
        ids: attachmentIds,
        entityType: 'training_request',
        entityId: id,
        purposes: ['training_document'],
        actor: user,
      });
      await this.audit.record(
        {
          module: 'training',
          entityType: 'training_request',
          entityId: id,
          action: 'add_attachment',
          actorId: user.id,
          actingAs: this.isRequester(row, user) ? 'requester' : viewer.isTrainingOffice ? 'back_office' : 'admin',
          metadata: { attachmentIds },
          entityLabel: trainingReference(row.number),
        },
        tx,
      );
    });
    return this.attachments.listFor('training_request', id);
  }

  async removeAttachment(id: string, attachmentId: string, user: AuthUser, ability: AppAbility): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const viewer = await this.access.viewer(user, ability);
      const row = await this.findVisible(id, viewer, tx);
      const attachment = await tx.attachment.findFirst({
        where: { id: attachmentId, entityType: 'training_request', entityId: id, deletedAt: null },
      });
      if (!attachment) throw ProblemException.notFound('Attachment');
      if (attachment.uploadedById !== user.id && !viewer.isBackOffice)
        throw ProblemException.forbidden('Only the uploader or the training office can remove this document.');
      await this.attachments.softDelete(tx, attachmentId);
      await this.audit.record(
        {
          module: 'training',
          entityType: 'training_request',
          entityId: id,
          action: 'remove_attachment',
          actorId: user.id,
          actingAs: viewer.isBackOffice && attachment.uploadedById !== user.id ? 'back_office' : 'requester',
          metadata: { attachmentId, originalName: attachment.originalName },
          entityLabel: trainingReference(row.number),
        },
        tx,
      );
    });
  }

  async timeline(id: string, user: AuthUser, ability: AppAbility) {
    const viewer = await this.access.viewer(user, ability);
    const row = await this.findVisible(id, viewer);
    const attendees = await this.prisma.trainingAttendee.findMany({
      where: { requestId: id, ...viewer.attendeeWhere() },
      include: { user: true },
    });
    const names = new Map(attendees.map((a) => [a.id, a.user.displayName]));
    const reference = trainingReference(row.number);
    return this.audit.timeline(
      [
        { entityType: 'training_request', entityId: id },
        ...attendees.map((a) => ({ entityType: 'training_attendee', entityId: a.id })),
      ],
      (e) => (e.entityType === 'training_request' ? reference : (names.get(e.entityId) ?? 'Attendee')),
    );
  }
}
