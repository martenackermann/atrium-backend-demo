import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import { hasRole } from '@/common/auth/auth-user';
import type { AppAbility } from '@/common/authz/ability.types';
import { toRefOrNull, toUserRef, toUserRefOrNull } from '@/common/domain/mappers';
import { type Paginated, paginate } from '@/common/http/pagination';
import { ProblemException } from '@/common/http/problem';
import { toPrismaOrderBy } from '@/common/http/sort';
import { Clock } from '@/common/time/clock.service';
import { dateFromIso, isoFromDate, isoFromDateOrNull } from '@/common/time/time';
import { PrismaService } from '@/database/prisma.service';
import type { PrismaTx } from '@/database/prisma.types';
import type { Prisma } from '@/generated/prisma/client';
import { ApprovalService } from '@/modules/core/approvals/approval.service';
import { AttachmentService } from '@/modules/core/attachments/attachment.service';
import { AuditService } from '@/modules/core/audit/audit.service';
import { lockRow, WorkflowService } from '@/modules/core/workflow';
import type {
  CreatePeopleRequestInput,
  ListPeopleRequestsQueryInput,
  PeopleCommentView,
  PeopleRequestDetailView,
  PeopleRequestSummaryView,
  PersonalDataInput,
  PersonalDataView,
  UpdatePeopleRequestInput,
} from '../dto/people-request.dto';
import { INTERNAL_FIELDS, REQUESTER_FIELDS } from '../dto/people-request.dto';
import { PeopleRequestWorkflow } from '../machines/people-request.workflow';
import {
  isPeopleBackOffice,
  OPEN_STATUSES,
  type PeopleAction,
  type PeopleRequestType,
  parsePeopleReference,
  peopleReference,
} from '../people.constants';
import {
  canComment,
  canEdit,
  canSeePersonalData,
  canView,
  isClosed,
  mineWhere,
  peopleRequestInclude,
  type PeopleRequestRow,
  visibleWhere,
} from './people-access';
import { PeopleNotifier } from './people-notifier.service';

type CommentRow = Prisma.PeopleRequestCommentGetPayload<{ include: { author: true } }>;

/** Resolved, validated values of the create/update fields. */
interface ResolvedFields {
  type: PeopleRequestType;
  jobRoleId: string | null;
  subjectUserId: string | null;
  salutation: PeopleRequestRow['salutation'];
  firstName: string;
  lastName: string;
  departmentId: string | null;
  siteId: string | null;
  managerId: string | null;
  managerDeputyId: string | null;
}

const PERSONAL_COLUMNS = [
  'birthDate',
  'placeOfBirth',
  'nationality',
  'privateStreet',
  'privateHouseNumber',
  'privatePostalCode',
  'privateCity',
  'privateCountryCode',
  'privatePhone',
  'privateEmail',
] as const;

export function toCommentView(row: CommentRow): PeopleCommentView {
  return {
    id: row.id,
    author: toUserRef(row.author),
    body: row.body,
    internal: row.internal,
    kind: row.kind,
    createdAt: row.createdAt.toISOString(),
  };
}

function personalDataOf(row: PeopleRequestRow): PersonalDataView {
  const hasAddress = row.privateStreet || row.privateCity || row.privatePostalCode;
  return {
    birthDate: isoFromDateOrNull(row.birthDate),
    placeOfBirth: row.placeOfBirth,
    nationality: row.nationality,
    privateAddress: hasAddress
      ? {
          street: row.privateStreet ?? '',
          houseNumber: row.privateHouseNumber ?? '',
          postalCode: row.privatePostalCode ?? '',
          city: row.privateCity ?? '',
          countryCode: row.privateCountryCode ?? '',
        }
      : null,
    privatePhone: row.privatePhone,
    privateEmail: row.privateEmail,
  };
}

/** Personal-data input -> column values (only the keys present in the input). */
function personalDataColumns(input: PersonalDataInput | null | undefined): Prisma.PeopleRequestUncheckedUpdateInput {
  if (input === undefined) return {};
  if (input === null) return Object.fromEntries(PERSONAL_COLUMNS.map((c) => [c, null]));
  const data: Prisma.PeopleRequestUncheckedUpdateInput = {};
  if (input.birthDate !== undefined) data.birthDate = input.birthDate ? dateFromIso(input.birthDate) : null;
  if (input.placeOfBirth !== undefined) data.placeOfBirth = input.placeOfBirth;
  if (input.nationality !== undefined) data.nationality = input.nationality ?? null;
  if (input.privatePhone !== undefined) data.privatePhone = input.privatePhone;
  if (input.privateEmail !== undefined) data.privateEmail = input.privateEmail;
  if (input.privateAddress !== undefined) {
    const a = input.privateAddress;
    data.privateStreet = a?.street ?? null;
    data.privateHouseNumber = a?.houseNumber ?? null;
    data.privatePostalCode = a?.postalCode ?? null;
    data.privateCity = a?.city ?? null;
    data.privateCountryCode = a?.countryCode ?? null;
  }
  return data;
}

/** Values compared in `update` audit diffs (names instead of ids, PII masked by the registry). */
function auditView(row: PeopleRequestRow): Record<string, unknown> {
  const personal = personalDataOf(row);
  return {
    title: row.title,
    priority: row.priority,
    jobRole: row.jobRole?.name ?? null,
    subject: row.subjectUser?.displayName ?? null,
    salutation: row.salutation,
    firstName: row.firstName,
    lastName: row.lastName,
    effectiveDate: isoFromDate(row.effectiveDate),
    department: row.department?.name ?? null,
    site: row.site?.name ?? null,
    manager: row.manager?.displayName ?? null,
    managerDeputy: row.managerDeputy?.displayName ?? null,
    reason: row.reason,
    furtherInformation: row.furtherInformation,
    equipmentNotes: row.equipmentNotes,
    ...personal,
    assignee: row.assignee?.displayName ?? null,
    internalNote: row.internalNote,
  };
}

/** People requests (SPEC §3.4, §5.4; API.md §7.1). */
@Injectable()
export class PeopleRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflows: WorkflowService,
    private readonly workflow: PeopleRequestWorkflow,
    private readonly approvals: ApprovalService,
    private readonly attachments: AttachmentService,
    private readonly audit: AuditService,
    private readonly notifier: PeopleNotifier,
    private readonly clock: Clock,
  ) {}

  // --- Reads ---------------------------------------------------------------------

  async list(
    user: AuthUser,
    ability: AppAbility,
    query: ListPeopleRequestsQueryInput,
  ): Promise<Paginated<PeopleRequestSummaryView>> {
    if (query.scope === 'all' && !isPeopleBackOffice(user)) {
      throw ProblemException.forbidden('Only People Ops can list all requests.');
    }
    const and: Prisma.PeopleRequestWhereInput[] = [query.scope === 'all' ? visibleWhere(user) : mineWhere(user)];
    if (query.status.length) and.push({ status: { in: query.status } });
    if (query.type.length) and.push({ type: { in: query.type } });
    if (query.priority.length) and.push({ priority: { in: query.priority } });
    if (query.assigneeId === 'me') and.push({ assigneeId: user.id });
    else if (query.assigneeId === 'none') and.push({ assigneeId: null });
    else if (query.assigneeId) and.push({ assigneeId: query.assigneeId });
    if (query.from) and.push({ effectiveDate: { gte: dateFromIso(query.from) } });
    if (query.to) and.push({ effectiveDate: { lte: dateFromIso(query.to) } });
    if (query.q) and.push(this.textFilter(query.q));
    const where: Prisma.PeopleRequestWhereInput = { AND: and };
    const orderBy = [
      ...toPrismaOrderBy(query.sort),
      { number: 'desc' },
    ] as Prisma.PeopleRequestOrderByWithRelationInput[];

    const page = await paginate(
      query,
      (p) => this.prisma.peopleRequest.findMany({ where, orderBy, include: peopleRequestInclude, ...p }),
      () => this.prisma.peopleRequest.count({ where }),
    );
    return {
      data: await Promise.all(page.data.map((row) => this.toSummary(row, user, ability))),
      meta: page.meta,
    };
  }

  /** `q`: exact reference, else title / names (ILIKE). */
  textFilter(q: string): Prisma.PeopleRequestWhereInput {
    const number = parsePeopleReference(q);
    if (number !== null) return { number };
    return {
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
      ],
    };
  }

  async findVisible(user: AuthUser, id: string, db: PrismaTx = this.prisma): Promise<PeopleRequestRow> {
    const row = await db.peopleRequest.findUnique({ where: { id }, include: peopleRequestInclude });
    if (!row || !canView(user, row)) throw ProblemException.notFound('People request');
    return row;
  }

  async detail(id: string, user: AuthUser, ability: AppAbility): Promise<PeopleRequestDetailView> {
    return this.toDetail(await this.findVisible(user, id), user, ability);
  }

  async timeline(id: string, user: AuthUser) {
    await this.findVisible(user, id);
    return this.audit.timeline([{ entityType: 'people_request', entityId: id }]);
  }

  async availableActions(row: PeopleRequestRow, user: AuthUser, ability: AppAbility): Promise<PeopleAction[]> {
    const actions = (await this.workflows.availableActions(
      this.workflow.definition,
      row,
      user,
      ability,
    )) as PeopleAction[];
    if (canEdit(user, row)) actions.push('edit');
    if (ability.can('edit_internal', 'PeopleRequest')) actions.push('edit_internal');
    if (canComment(user, row)) actions.push('comment');
    if (ability.can('comment_internal', 'PeopleRequest')) actions.push('comment_internal');
    return actions;
  }

  async toSummary(row: PeopleRequestRow, user: AuthUser, ability: AppAbility): Promise<PeopleRequestSummaryView> {
    return {
      id: row.id,
      reference: peopleReference(row.number),
      type: row.type,
      title: row.title,
      priority: row.priority,
      status: row.status,
      subjectName: `${row.firstName} ${row.lastName}`,
      subjectUser: toUserRefOrNull(row.subjectUser),
      effectiveDate: isoFromDate(row.effectiveDate),
      jobRole: row.jobRole ? { id: row.jobRole.id, name: row.jobRole.name } : null,
      requester: toUserRef(row.requester),
      manager: toUserRefOrNull(row.manager),
      assignee: toUserRefOrNull(row.assignee),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      availableActions: await this.availableActions(row, user, ability),
    };
  }

  async toDetail(row: PeopleRequestRow, user: AuthUser, ability: AppAbility): Promise<PeopleRequestDetailView> {
    const personal = canSeePersonalData(user, row);
    const [summary, attachments, openQuestion] = await Promise.all([
      this.toSummary(row, user, ability),
      personal ? this.attachments.listFor('people_request', row.id) : Promise.resolve([]),
      row.status === 'waiting_on_requester'
        ? this.prisma.peopleRequestComment.findFirst({
            where: { requestId: row.id, kind: 'question', internal: false },
            include: { author: true },
            orderBy: { createdAt: 'desc' },
          })
        : Promise.resolve(null),
    ]);
    return {
      ...summary,
      salutation: row.salutation,
      firstName: row.firstName,
      lastName: row.lastName,
      department: toRefOrNull(row.department),
      site: toRefOrNull(row.site),
      managerDeputy: toUserRefOrNull(row.managerDeputy),
      reason: row.reason,
      furtherInformation: row.furtherInformation,
      equipmentNotes: row.equipmentNotes,
      personalData: personal ? personalDataOf(row) : null,
      personalDataRedacted: !personal,
      internalNote: isPeopleBackOffice(user) ? row.internalNote : null,
      attachments,
      openQuestion: openQuestion ? toCommentView(openQuestion) : null,
      statusReason: row.statusReason,
      closedAt: row.closedAt?.toISOString() ?? null,
      version: row.version,
    };
  }

  // --- Create / update -------------------------------------------------------------

  async create(user: AuthUser, input: CreatePeopleRequestInput): Promise<PeopleRequestRow> {
    const fields = await this.resolveFields(user, input.type, {
      jobRoleId: input.jobRoleId ?? null,
      subjectUserId: input.subjectUserId ?? null,
      salutation: input.salutation ?? null,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      departmentId: input.departmentId,
      siteId: input.siteId,
      managerId: input.managerId,
      managerDeputyId: input.managerDeputyId ?? null,
    });

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.peopleRequest.create({
        data: {
          ...fields,
          title: input.title,
          priority: input.priority ?? 'normal',
          status: 'open',
          effectiveDate: dateFromIso(input.effectiveDate),
          requesterId: user.id,
          reason: input.reason ?? null,
          furtherInformation: input.furtherInformation ?? null,
          equipmentNotes: input.equipmentNotes ?? null,
          ...(personalDataColumns(input.personalData ?? null) as Partial<Prisma.PeopleRequestUncheckedCreateInput>),
        },
        include: peopleRequestInclude,
      });
      if (input.attachmentIds?.length) {
        await this.attachments.link(tx, {
          ids: input.attachmentIds,
          entityType: 'people_request',
          entityId: created.id,
          purposes: ['people_document'],
          actor: user,
        });
      }
      await this.audit.record(
        {
          module: 'people',
          entityType: 'people_request',
          entityId: created.id,
          action: 'create',
          actorId: user.id,
          actingAs: 'requester',
          toState: 'open',
          entityLabel: `${peopleReference(created.number)} ${created.title}`,
        },
        tx,
      );
      await this.notifier.created(tx, created);
      return created;
    });
  }

  async update(user: AuthUser, id: string, input: UpdatePeopleRequestInput): Promise<PeopleRequestRow> {
    const keys = Object.keys(input).filter((k) => k !== 'version' && input[k as keyof typeof input] !== undefined);
    return this.prisma.$transaction(async (tx) => {
      await lockRow(tx, 'people_requests', id);
      const row = await this.findVisible(user, id, tx);
      const backOffice = isPeopleBackOffice(user);
      const wantsInternal = keys.some((k) => (INTERNAL_FIELDS as readonly string[]).includes(k));
      const wantsFields = keys.some((k) => (REQUESTER_FIELDS as readonly string[]).includes(k));

      if (wantsInternal && !backOffice) throw ProblemException.forbidden('Only People Ops can change these fields.');
      if (wantsFields) {
        if (backOffice && isClosed(row.status)) throw ProblemException.invalidTransition('edit', row.status);
        if (!canEdit(user, row)) {
          throw ProblemException.forbidden(
            row.requesterId === user.id
              ? 'You can change the request only while it is open. Add a comment instead.'
              : 'You are not allowed to change this request.',
          );
        }
      }
      if (input.personalData !== undefined && !canSeePersonalData(user, row)) {
        // it_admin never edits personal data (SPEC_RESOLUTIONS #24).
        throw ProblemException.forbidden('Only the requester, the manager and People Ops can change personal data.');
      }
      if (input.version !== undefined && input.version !== row.version) throw ProblemException.versionConflict();
      if (keys.length === 0) return row;

      const fields = wantsFields
        ? await this.resolveFields(
            user,
            row.type,
            {
              jobRoleId: input.jobRoleId !== undefined ? input.jobRoleId : row.jobRoleId,
              subjectUserId: input.subjectUserId !== undefined ? input.subjectUserId : row.subjectUserId,
              salutation: input.salutation !== undefined ? input.salutation : row.salutation,
              firstName: input.firstName ?? row.firstName,
              lastName: input.lastName ?? row.lastName,
              departmentId: input.departmentId !== undefined ? input.departmentId : row.departmentId,
              siteId: input.siteId !== undefined ? input.siteId : row.siteId,
              managerId: input.managerId !== undefined ? input.managerId : row.managerId,
              managerDeputyId: input.managerDeputyId !== undefined ? input.managerDeputyId : row.managerDeputyId,
            },
            { subjectChanged: input.subjectUserId !== undefined && input.subjectUserId !== row.subjectUserId },
          )
        : null;

      const data: Prisma.PeopleRequestUncheckedUpdateManyInput = {
        ...(fields ? { ...fields, type: undefined } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.effectiveDate !== undefined ? { effectiveDate: dateFromIso(input.effectiveDate) } : {}),
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        ...(input.furtherInformation !== undefined ? { furtherInformation: input.furtherInformation } : {}),
        ...(input.equipmentNotes !== undefined ? { equipmentNotes: input.equipmentNotes } : {}),
        ...(personalDataColumns(input.personalData) as Prisma.PeopleRequestUncheckedUpdateManyInput),
        version: { increment: 1 },
      };
      if (input.assigneeId !== undefined) {
        if (input.assigneeId) await this.assertAssignable(tx, input.assigneeId);
        data.assigneeId = input.assigneeId;
      }
      if (input.internalNote !== undefined) data.internalNote = input.internalNote;

      const result = await tx.peopleRequest.updateMany({ where: { id, version: row.version }, data });
      if (result.count === 0) throw ProblemException.versionConflict();
      const updated = await tx.peopleRequest.findUniqueOrThrow({ where: { id }, include: peopleRequestInclude });

      const changes = this.audit.diff('people_request', auditView(row), auditView(updated));
      await this.audit.record(
        {
          module: 'people',
          entityType: 'people_request',
          entityId: id,
          action: 'update',
          actorId: user.id,
          actingAs: backOffice ? (hasRole(user, 'people_ops') ? 'back_office' : 'admin') : 'requester',
          changes: changes.length ? changes : null,
          entityLabel: `${peopleReference(updated.number)} ${updated.title}`,
        },
        tx,
      );
      return updated;
    });
  }

  /** Validates the type-specific fields (422 per field) and fills defaults from the subject. */
  private async resolveFields(
    user: AuthUser,
    type: PeopleRequestType,
    input: {
      jobRoleId: string | null;
      subjectUserId: string | null;
      salutation: PeopleRequestRow['salutation'];
      firstName: string | null;
      lastName: string | null;
      departmentId: string | null | undefined;
      siteId: string | null | undefined;
      managerId: string | null | undefined;
      managerDeputyId: string | null;
    },
    options: { subjectChanged?: boolean } = {},
  ): Promise<ResolvedFields> {
    const errors: Record<string, string[]> = {};
    const fail = (field: string, message: string) => (errors[field] = [...(errors[field] ?? []), message]);
    const users = await this.prisma.user.findMany({
      where: {
        id: {
          in: [input.subjectUserId, input.managerId, input.managerDeputyId].filter((v): v is string => !!v),
        },
      },
    });
    const userById = (id: string | null | undefined) => (id ? users.find((u) => u.id === id) : undefined);

    // Job role: required for onboarding, optional for role changes (SPEC_RESOLUTIONS #20).
    if (type === 'onboarding' && !input.jobRoleId) fail('jobRoleId', 'Choose the job role of the new colleague.');
    if (input.jobRoleId) {
      const role = await this.prisma.jobRole.findUnique({ where: { id: input.jobRoleId } });
      if (!role || !role.active) fail('jobRoleId', 'This job role does not exist or is no longer offered.');
    }

    // Subject: the existing person (offboarding, role change); onboarding names a new person.
    const subject = userById(input.subjectUserId);
    let firstName = input.firstName;
    let lastName = input.lastName;
    if (type === 'onboarding') {
      if (input.subjectUserId) fail('subjectUserId', 'Onboarding is for a new colleague; leave the person empty.');
      if (!firstName) fail('firstName', 'Enter the first name.');
      if (!lastName) fail('lastName', 'Enter the last name.');
    } else if (!input.subjectUserId) {
      fail('subjectUserId', 'Choose the person this request is about.');
    } else if (!subject || (!subject.active && (options.subjectChanged ?? true))) {
      fail('subjectUserId', 'Choose an active colleague.');
    } else {
      firstName = subject.firstName;
      lastName = subject.lastName;
      // Non-back-office requesters may only name themselves or their reporting tree (SPEC §6.4).
      if (
        !isPeopleBackOffice(user) &&
        (options.subjectChanged ?? true) &&
        !(await this.approvals.mayActFor(user.id, subject.id))
      ) {
        fail('subjectUserId', 'You can only request for yourself or your team.');
      }
    }

    // Manager: required for onboarding; defaults to the subject's manager otherwise.
    let managerId = input.managerId === undefined ? null : input.managerId;
    if (!managerId && type !== 'onboarding' && subject && input.managerId === undefined) {
      managerId = subject.managerId;
    }
    if (type === 'onboarding' && !managerId) fail('managerId', 'Choose the manager of the new colleague.');
    if (input.managerId) {
      const manager = userById(input.managerId);
      if (!manager || !manager.active) fail('managerId', 'Choose an active colleague as manager.');
    }
    if (input.managerDeputyId) {
      const deputy = userById(input.managerDeputyId);
      if (!deputy || !deputy.active) fail('managerDeputyId', "Choose an active colleague as the manager's deputy.");
      else if (input.managerDeputyId === managerId) {
        fail('managerDeputyId', "The manager's deputy must be someone other than the manager.");
      }
    }

    let departmentId = input.departmentId === undefined ? (subject?.departmentId ?? null) : input.departmentId;
    let siteId = input.siteId === undefined ? (subject?.siteId ?? null) : input.siteId;
    if (input.departmentId) {
      const exists = await this.prisma.department.count({ where: { id: input.departmentId } });
      if (!exists) fail('departmentId', 'This department does not exist.');
    }
    if (input.siteId) {
      const exists = await this.prisma.site.count({ where: { id: input.siteId } });
      if (!exists) fail('siteId', 'This site does not exist.');
    }
    if (Object.keys(errors).length) throw ProblemException.validation(errors);
    departmentId ??= null;
    siteId ??= null;

    return {
      type,
      jobRoleId: input.jobRoleId,
      subjectUserId: type === 'onboarding' ? null : input.subjectUserId,
      salutation: input.salutation,
      firstName: firstName!,
      lastName: lastName!,
      departmentId,
      siteId,
      managerId,
      managerDeputyId: input.managerDeputyId,
    };
  }

  private async assertAssignable(tx: PrismaTx, userId: string): Promise<void> {
    const assignee = await tx.user.findUnique({ where: { id: userId }, include: { roles: true } });
    const ok = assignee?.active && assignee.roles.some((r) => r.role === 'people_ops' || r.role === 'it_admin');
    if (!ok) throw ProblemException.fieldError('assigneeId', 'Assign the request to someone in People Ops.');
  }

  // --- Comments ----------------------------------------------------------------------

  async comments(id: string, user: AuthUser): Promise<PeopleCommentView[]> {
    await this.findVisible(user, id);
    const rows = await this.prisma.peopleRequestComment.findMany({
      where: { requestId: id, ...(isPeopleBackOffice(user) ? {} : { internal: false }) },
      include: { author: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toCommentView);
  }

  /**
   * Adds a comment. A requester's public comment while the request waits on them fires the
   * system event `requester_replied` (-> in_progress) in the same transaction.
   */
  async addComment(
    id: string,
    user: AuthUser,
    ability: AppAbility,
    input: { body: string; internal?: boolean },
  ): Promise<PeopleCommentView> {
    const row = await this.findVisible(user, id);
    const internal = input.internal ?? false;
    if (internal) {
      if (!ability.can('comment_internal', 'PeopleRequest')) {
        throw ProblemException.forbidden('Only People Ops can write internal comments.');
      }
    } else if (!canComment(user, row)) {
      if (isClosed(row.status) && canView(user, row) && (isPeopleBackOffice(user) || row.requesterId === user.id)) {
        throw ProblemException.invalidTransition('comment', row.status);
      }
      throw ProblemException.forbidden('You can read this request but not comment on it.');
    }

    if (!internal && row.requesterId === user.id && row.status === 'waiting_on_requester') {
      await this.workflows.apply(this.workflow.replyDefinition, {
        id,
        action: 'requester_replied',
        actor: user,
        ability,
        input: { body: input.body },
      });
      const reply = await this.prisma.peopleRequestComment.findFirstOrThrow({
        where: { requestId: id, authorId: user.id, kind: 'comment' },
        include: { author: true },
        orderBy: { createdAt: 'desc' },
      });
      return toCommentView(reply);
    }

    return this.prisma.$transaction(async (tx) => {
      const comment = await tx.peopleRequestComment.create({
        data: {
          requestId: id,
          authorId: user.id,
          body: input.body,
          internal,
          kind: 'comment',
          createdAt: this.clock.now(),
        },
        include: { author: true },
      });
      if (!internal) await this.notifier.commentAdded(tx, row, user, input.body);
      return toCommentView(comment);
    });
  }

  // --- Queue counts ------------------------------------------------------------------

  async queueCounts(user: AuthUser) {
    const open = { in: [...OPEN_STATUSES] };
    const [mineOpen, waitingOnMe] = await Promise.all([
      this.prisma.peopleRequest.count({ where: { AND: [mineWhere(user), { status: open }] } }),
      this.prisma.peopleRequest.count({ where: { requesterId: user.id, status: 'waiting_on_requester' } }),
    ]);
    let ops = null;
    if (isPeopleBackOffice(user)) {
      const grouped = await this.prisma.peopleRequest.groupBy({ by: ['status'], _count: { _all: true } });
      const count = (status: string) => grouped.find((g) => g.status === status)?._count._all ?? 0;
      const [unassigned, critical] = await Promise.all([
        this.prisma.peopleRequest.count({ where: { status: open, assigneeId: null } }),
        this.prisma.peopleRequest.count({ where: { status: open, priority: 'critical' } }),
      ]);
      ops = {
        open: count('open'),
        reopened: count('reopened'),
        inProgress: count('in_progress'),
        waiting: count('waiting_internal') + count('waiting_on_requester'),
        unassigned,
        critical,
      };
    }
    return { mine: { open: mineOpen, waitingOnMe }, ops };
  }
}
