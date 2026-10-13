import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import type { AppAbility } from '@/common/authz/ability.types';
import type { ActingAs } from '@/common/domain/vocabulary';
import { type Paginated, paginate } from '@/common/http/pagination';
import { type FieldErrors, ProblemException } from '@/common/http/problem';
import { parseSortOrThrow, toPrismaOrderBy } from '@/common/http/sort';
import { Clock } from '@/common/time/clock.service';
import { addDaysIso, isoDateInZone, startOfDayInZone } from '@/common/time/time';
import { AppConfig } from '@/config/app-config';
import { PrismaService } from '@/database/prisma.service';
import type { PrismaTx } from '@/database/prisma.types';
import type { Prisma } from '@/generated/prisma/client';
import { ApprovalService } from '@/modules/core/approvals/approval.service';
import { AttachmentService } from '@/modules/core/attachments/attachment.service';
import { AuditService, type TimelineEntryView } from '@/modules/core/audit/audit.service';
import { WorkflowService } from '@/modules/core/workflow/workflow.service';
import { decryptPin } from '../domain/pin-cipher';
import { formatDateTime, toCsv } from '../domain/travel-format';
import {
  buildRoute,
  evaluateApprovalReasons,
  highPriorityWhere,
  isAdultOn,
  isHighPriority,
  specialEquipmentReasonRequired,
} from '../domain/travel-rules';
import type {
  CarInput,
  CreateTravelRequestInput,
  FlightInput,
  ListTravelQueryInput,
  TrainInput,
  TravelPreviewInput,
  TravelScope,
} from '../dto/travel-request.dto';
import { TRAVEL_SORT_FIELDS } from '../dto/travel-request.dto';
import { TravelWorkflow } from '../machines/travel-request.workflow';
import {
  ACTIVE_TRAVEL_STATUSES,
  APPROVAL_EXEMPTION_LABELS,
  APPROVAL_REASON_LABELS,
  type ApprovalReasonCode,
  KIND_LABELS,
  parseTravelReference,
  TRAVEL_BOOKING_ENTITY,
  TRAVEL_ENTITY,
  type TravelAction,
  travelReference,
} from '../travel.constants';
import { TRAVEL_ENUMS } from '../travel.enums';
import { type TravelAccessRow, TravelAccessService, type TravelViewer } from './travel-access.service';
import { reasonDtos, type TravelDetailView, type TravelSummaryView, toDetail, toSummary } from './travel-mapper';
import { TravelNotifier } from './travel-notifier.service';
import { travelDetailInclude, type TravelRow, travelSummaryInclude, type TravelSummaryRow } from './travel-row';

type ListFilters = Omit<ListTravelQueryInput, 'page' | 'perPage' | 'scope' | 'sort'>;

interface KindPlan {
  startsAt: Date;
  endsAt: Date | null;
  route: string;
  reasons: ApprovalReasonCode[];
  data: Pick<Prisma.TravelRequestUncheckedCreateInput, 'car' | 'train' | 'flight' | 'companions'>;
}

const EXPORT_LIMIT = 5000;

/**
 * Travel requests (API.md §5): lists with scopes, detail, preview, create, timeline, PIN,
 * queue counts and CSV export. Transitions run through the core WorkflowService.
 */
@Injectable()
export class TravelRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TravelAccessService,
    private readonly workflows: WorkflowService,
    private readonly travelWorkflow: TravelWorkflow,
    private readonly approvals: ApprovalService,
    private readonly attachments: AttachmentService,
    private readonly audit: AuditService,
    private readonly notifier: TravelNotifier,
    private readonly clock: Clock,
    private readonly config: AppConfig,
  ) {}

  private get highPriorityDays(): number {
    return this.config.get('TRAVEL_HIGH_PRIORITY_DAYS');
  }

  // ---------------------------------------------------------------------------
  // Read side
  // ---------------------------------------------------------------------------

  /** availableActions = machine ∧ permission (D7) + the `view_pin` capability. */
  async actionsFor(
    row: TravelSummaryRow | TravelRow,
    viewer: TravelViewer,
    ability: AppAbility,
  ): Promise<TravelAction[]> {
    const actions = (await this.workflows.availableActions(
      this.travelWorkflow.definition,
      row,
      viewer.user,
      ability,
    )) as TravelAction[];
    if (this.access.canViewPin(viewer, row)) actions.push('view_pin');
    return actions;
  }

  /** The viewer's approval relation for a pending row (approver / deputy / manager_chain). */
  actingAsFor(viewer: TravelViewer, row: TravelAccessRow & { status: string }): ActingAs | null {
    if (row.status !== 'pending_approval') return null;
    return this.access.decideRight(viewer, row) || null;
  }

  private async summary(row: TravelSummaryRow, viewer: TravelViewer, ability: AppAbility): Promise<TravelSummaryView> {
    return toSummary(row, {
      now: this.clock.now(),
      highPriorityDays: this.highPriorityDays,
      availableActions: await this.actionsFor(row, viewer, ability),
      actingAs: this.actingAsFor(viewer, row),
    });
  }

  async toDetailView(row: TravelRow, viewer: TravelViewer, ability: AppAbility): Promise<TravelDetailView> {
    return toDetail(row, {
      now: this.clock.now(),
      highPriorityDays: this.highPriorityDays,
      availableActions: await this.actionsFor(row, viewer, ability),
      actingAs: this.actingAsFor(viewer, row),
      showDriver: this.access.canSeeDriver(viewer, row),
      bookingAttachments: row.booking ? await this.attachments.listFor(TRAVEL_BOOKING_ENTITY, row.id) : [],
    });
  }

  private async findVisible(id: string, user: AuthUser): Promise<{ row: TravelRow; viewer: TravelViewer }> {
    const [row, viewer] = await Promise.all([
      this.prisma.travelRequest.findUnique({ where: { id }, include: travelDetailInclude }),
      this.access.viewer(user),
    ]);
    if (!row || !this.access.canView(viewer, row)) throw ProblemException.notFound('Travel request');
    return { row, viewer };
  }

  async detail(id: string, user: AuthUser, ability: AppAbility): Promise<TravelDetailView> {
    const { row, viewer } = await this.findVisible(id, user);
    return this.toDetailView(row, viewer, ability);
  }

  async list(user: AuthUser, ability: AppAbility, query: ListTravelQueryInput): Promise<Paginated<TravelSummaryView>> {
    const viewer = await this.access.viewer(user);
    const where: Prisma.TravelRequestWhereInput = {
      AND: [this.access.visibleWhere(viewer), this.scopeWhere(viewer, query.scope), this.filterWhere(query)],
    };
    const defaultSort = query.scope === 'mine' ? '-createdAt' : 'startsAt';
    const orderBy = [
      ...toPrismaOrderBy(parseSortOrThrow(query.sort ?? defaultSort, TRAVEL_SORT_FIELDS)),
      { number: 'asc' as const },
    ] as Prisma.TravelRequestOrderByWithRelationInput[];
    const page = await paginate(
      query,
      (p) => this.prisma.travelRequest.findMany({ where, orderBy, include: travelSummaryInclude, ...p }),
      () => this.prisma.travelRequest.count({ where }),
    );
    return { data: await Promise.all(page.data.map((row) => this.summary(row, viewer, ability))), meta: page.meta };
  }

  /** Scopes (SPEC_RESOLUTIONS #18); rows about the viewer never appear in approval scopes (#13). */
  private scopeWhere(viewer: TravelViewer, scope: TravelScope): Prisma.TravelRequestWhereInput {
    const me = viewer.user.id;
    switch (scope) {
      case 'mine':
        return { OR: [{ travellerId: me }, { requesterId: me }, { companions: { some: { userId: me } } }] };
      case 'approvals':
        return { status: 'pending_approval', approverId: me, travellerId: { not: me } };
      case 'deputy':
        return { status: 'pending_approval', approverId: { in: viewer.principalIds }, travellerId: { not: me } };
      case 'team':
        return { travellerId: { in: [...viewer.treeIds] } };
      case 'all':
        if (!this.access.seesAll(viewer))
          throw ProblemException.forbidden('Only the travel desk can list all requests.');
        return {};
    }
  }

  private filterWhere(filters: ListFilters): Prisma.TravelRequestWhereInput {
    const and: Prisma.TravelRequestWhereInput[] = [];
    if (filters.kind.length) and.push({ kind: { in: filters.kind } });
    if (filters.status.length) and.push({ status: { in: filters.status } });
    if (filters.q) {
      const number = parseTravelReference(filters.q);
      and.push(
        number !== null
          ? { number }
          : {
              OR: [
                { routeSummary: { contains: filters.q, mode: 'insensitive' } },
                { traveller: { displayName: { contains: filters.q, mode: 'insensitive' } } },
              ],
            },
      );
    }
    const tz = this.clock.timeZone;
    if (filters.from) and.push({ startsAt: { gte: startOfDayInZone(filters.from, tz) } });
    if (filters.to) and.push({ startsAt: { lt: startOfDayInZone(addDaysIso(filters.to, 1), tz) } });
    if (filters.highPriority === true) and.push(highPriorityWhere(this.clock.now(), this.highPriorityDays));
    return and.length ? { AND: and } : {};
  }

  async timeline(id: string, user: AuthUser): Promise<TimelineEntryView[]> {
    const { row } = await this.findVisible(id, user);
    const label = travelReference(row.number);
    return this.audit.timeline([{ entityType: TRAVEL_ENTITY, entityId: id }], () => label);
  }

  /** Audited PIN reveal (D12, SPEC_RESOLUTIONS #24). */
  async pin(id: string, user: AuthUser): Promise<{ pin: string }> {
    const { row, viewer } = await this.findVisible(id, user);
    if (!row.booking?.pinEncrypted || !this.access.pinActive(row)) throw ProblemException.notFound('PIN');
    if (!this.access.canViewPin(viewer, row))
      throw ProblemException.forbidden('Only the traveller, the requester and the travel desk can see the PIN.');
    const pin = decryptPin(row.booking.pinEncrypted, this.config.get('ENCRYPTION_KEY'));
    const actingAs: ActingAs =
      row.travellerId === user.id ? 'self' : row.requesterId === user.id ? 'requester' : 'back_office';
    await this.audit.record({
      module: 'travel',
      entityType: TRAVEL_ENTITY,
      entityId: row.id,
      action: 'view_pin',
      actorId: user.id,
      actingAs,
      entityLabel: travelReference(row.number),
    });
    return { pin };
  }

  async counts(user: AuthUser) {
    const viewer = await this.access.viewer(user);
    const pending = 'pending_approval' as const;
    const [active, approvalsMine, deputy, teamRows] = await Promise.all([
      this.prisma.travelRequest.count({
        where: { status: { in: ACTIVE_TRAVEL_STATUSES }, ...this.scopeWhere(viewer, 'mine') },
      }),
      this.prisma.travelRequest.count({ where: this.scopeWhere(viewer, 'approvals') }),
      viewer.principalIds.length ? this.prisma.travelRequest.count({ where: this.scopeWhere(viewer, 'deputy') }) : 0,
      viewer.treeIds.size
        ? this.prisma.travelRequest.findMany({
            where: { status: pending, travellerId: { in: [...viewer.treeIds] } },
            select: { travellerId: true, requesterId: true, approverId: true },
          })
        : [],
    ]);
    // Team: pending items I may decide only through the manager-chain override.
    const team = teamRows.filter((row) => this.access.decideRight(viewer, row) === 'manager_chain').length;

    let desk = null;
    if (this.access.seesAll(viewer)) {
      const count = (where: Prisma.TravelRequestWhereInput) => this.prisma.travelRequest.count({ where });
      const now = this.clock.now();
      const [pendingApproval, toBook, toBookHighPriority, cancellationRequested, bookingImpossible] = await Promise.all(
        [
          count({ status: pending }),
          count({ status: 'to_book' }),
          count({ ...highPriorityWhere(now, this.highPriorityDays), status: 'to_book' }),
          count({ status: 'cancellation_requested' }),
          count({ status: 'booking_impossible' }),
        ],
      );
      desk = { pendingApproval, toBook, toBookHighPriority, cancellationRequested, bookingImpossible };
    }
    return { mine: { active }, approvals: { mine: approvalsMine, deputy, team }, desk };
  }

  /** CSV export (desk / it_admin) with the list filters, scope = all. */
  async exportCsv(user: AuthUser, filters: ListFilters): Promise<string> {
    const viewer = await this.access.viewer(user);
    if (!this.access.seesAll(viewer)) throw ProblemException.forbidden('Only the travel desk can export requests.');
    const rows = await this.prisma.travelRequest.findMany({
      where: this.filterWhere(filters),
      orderBy: [{ startsAt: 'asc' }, { number: 'asc' }],
      include: { traveller: true, requester: true, approver: true, costCenter: true, booking: true },
      take: EXPORT_LIMIT,
    });
    const tz = this.clock.timeZone;
    const status = (value: string) => TRAVEL_ENUMS.travelStatus.find((o) => o.value === value)?.label ?? value;
    return toCsv(
      [
        'Reference',
        'Kind',
        'Status',
        'Traveller',
        'Requester',
        'Approver',
        'Route',
        'Starts',
        'Ends',
        'Needs approval',
        'Approval reasons',
        'Exemption',
        'Cost centre',
        'Recharge customer',
        'Recharge project',
        'Booking number',
        'Created',
      ],
      rows.map((r) => [
        travelReference(r.number),
        KIND_LABELS[r.kind],
        status(r.status),
        r.traveller.displayName,
        r.requester.displayName,
        r.approver?.displayName ?? '',
        r.routeSummary,
        formatDateTime(r.startsAt, tz),
        r.endsAt ? formatDateTime(r.endsAt, tz) : '',
        r.needsApproval ? 'yes' : 'no',
        r.approvalReasons.map((c) => APPROVAL_REASON_LABELS[c]).join('; '),
        r.approvalExemption ? APPROVAL_EXEMPTION_LABELS[r.approvalExemption] : '',
        r.costCenter.code,
        r.rechargeCustomer ?? '',
        r.rechargeProjectNumber ?? '',
        r.booking?.bookingNumber ?? '',
        r.createdAt.toISOString(),
      ]),
    );
  }

  // ---------------------------------------------------------------------------
  // Transitions
  // ---------------------------------------------------------------------------

  async act(id: string, action: string, body: unknown, user: AuthUser, ability: AppAbility) {
    await this.workflows.apply(this.travelWorkflow.definition, { id, action, actor: user, ability, input: body });
    return this.detail(id, user, ability);
  }

  // ---------------------------------------------------------------------------
  // Preview + create
  // ---------------------------------------------------------------------------

  /** Lenient preview (SPEC_RESOLUTIONS #3) for the stepper summary. */
  async preview(user: AuthUser, input: TravelPreviewInput) {
    const viewer = await this.access.viewer(user);
    const traveller = viewer.org.get(input.travellerId);
    if (!traveller?.active) throw ProblemException.fieldError('travellerId', 'Choose an active colleague.');
    if (!this.access.mayCreateFor(viewer, traveller.id)) {
      throw ProblemException.fieldError('travellerId', 'You can only request for yourself or your team');
    }
    const exempt = traveller.isExecutive;

    let classIsDefault: boolean | null = null;
    if (input.kind === 'car' && input.car?.carClassId) {
      const cls = await this.prisma.carRentalClass.findUnique({ where: { id: input.car.carClassId } });
      classIsDefault = cls ? cls.isDefault : null;
    }
    const reasons = exempt
      ? []
      : evaluateApprovalReasons({
          kind: input.kind,
          car: input.car
            ? {
                classIsDefault,
                equipment: input.car.equipment,
                handoverMode: input.car.handover?.mode ?? null,
                dropOffMode: input.car.dropOff?.mode ?? null,
              }
            : null,
          train: input.train ? { fareType: input.train.fareType, separateTickets: input.train.separateTickets } : null,
        });
    const needsApproval = reasons.length > 0;

    const chain = await this.approvals.approverChain(traveller.id);
    const defaultApproverId = chain.default?.user.id ?? null;
    const chosen =
      input.approverId && chain.candidates.some((c) => c.user.id === input.approverId && c.selectable)
        ? input.approverId
        : defaultApproverId;
    const autoApproval = needsApproval && chosen === user.id ? ('requester_is_approver' as const) : null;

    const start =
      input.kind === 'car'
        ? input.car?.pickupAt
        : input.kind === 'train'
          ? input.train?.outboundAt
          : input.flight?.outboundDepartureAt;
    const status = needsApproval && !autoApproval ? 'pending_approval' : 'to_book';

    return {
      needsApproval,
      reasons: reasonDtos(reasons),
      exemption: exempt
        ? { code: 'executive_traveller' as const, label: APPROVAL_EXEMPTION_LABELS.executive_traveller }
        : null,
      approverCandidates: chain.candidates,
      defaultApproverId,
      autoApproval,
      isHighPriority: start ? isHighPriority(status, new Date(start), this.clock.now(), this.highPriorityDays) : false,
      specialEquipmentReasonRequired: input.kind === 'car' && specialEquipmentReasonRequired(reasons),
    };
  }

  async create(user: AuthUser, ability: AppAbility, input: CreateTravelRequestInput): Promise<TravelDetailView> {
    const viewer = await this.access.viewer(user);
    const errors: FieldErrors = {};
    const add = (field: string, message: string) => (errors[field] ??= []).push(message);
    const now = this.clock.now();
    const backOffice = this.access.seesAll(viewer);

    // Traveller + "creating for others" (SPEC §6.4).
    const traveller = viewer.org.get(input.travellerId);
    if (!traveller?.active) add('travellerId', 'Choose an active colleague.');
    else if (!this.access.mayCreateFor(viewer, traveller.id)) {
      add('travellerId', 'You can only request for yourself or your team');
    }
    const travellerRow = traveller
      ? await this.prisma.user.findUnique({ where: { id: traveller.id }, select: { costCenterId: true } })
      : null;

    // Cost centre (default: the traveller's; another one needs a reason).
    if (input.costCenterId) {
      const cc = await this.prisma.costCenter.findUnique({ where: { id: input.costCenterId } });
      if (!cc?.active) add('costCenterId', 'Choose an active cost centre.');
    }
    const costCenterId = input.costCenterId ?? travellerRow?.costCenterId ?? null;
    const otherCostCenter = !!travellerRow && costCenterId !== travellerRow.costCenterId;
    if (otherCostCenter && !input.costCenterReason) {
      add('costCenterReason', 'Explain why another cost centre pays for this trip.');
    }

    const exempt = !!traveller?.isExecutive;
    const plan = await this.planKind(input, { now, backOffice, travellerId: input.travellerId, add });
    const reasons = exempt ? [] : plan.reasons;
    if (input.kind === 'car' && specialEquipmentReasonRequired(reasons)) {
      const text = input.car.specialEquipmentReason ?? '';
      if (text.length < 10) add('car.specialEquipmentReason', 'Explain in at least 10 characters why you need this.');
    }
    const needsApproval = reasons.length > 0;

    // Approver (SPEC §6.1; the requester may pick a selectable candidate instead).
    let approver: {
      id: string;
      reason: Prisma.TravelRequestUncheckedCreateInput['approverReason'];
      escalatedFromId: string | null;
      selection: 'auto' | 'manual';
    } | null = null;
    if (needsApproval && traveller?.active) {
      const resolved = await this.approvals.resolveApprover(traveller.id, user.id);
      if (input.approverId && input.approverId !== resolved.approverId) {
        const chain = await this.approvals.approverChain(traveller.id);
        const candidate = chain.candidates.find((c) => c.user.id === input.approverId);
        if (!candidate?.selectable) add('approverId', "Choose an approver from the traveller's management chain.");
        else approver = { id: candidate.user.id, reason: null, escalatedFromId: null, selection: 'manual' };
      } else {
        approver = {
          id: resolved.approverId,
          reason: resolved.reason,
          escalatedFromId: resolved.escalatedFromId,
          selection: 'auto',
        };
      }
    }

    if (Object.keys(errors).length) throw ProblemException.validation(errors);

    const autoApproved = !!approver && approver.id === user.id;
    const status = needsApproval && !autoApproved ? 'pending_approval' : 'to_book';
    const createdAt = now;

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.travelRequest.create({
        data: {
          kind: input.kind,
          travellerId: input.travellerId,
          requesterId: user.id,
          approverId: approver?.id ?? null,
          approverSelection: approver?.selection ?? null,
          approverReason: approver?.reason ?? null,
          escalatedFromId: approver?.escalatedFromId ?? null,
          status,
          needsApproval,
          approvalReasons: reasons,
          approvalExemption: exempt ? 'executive_traveller' : null,
          startsAt: plan.startsAt,
          endsAt: plan.endsAt,
          routeSummary: plan.route,
          costCenterId: costCenterId!,
          costCenterReason: otherCostCenter ? input.costCenterReason : null,
          rechargeCustomer: input.recharge?.customer ?? null,
          rechargeProjectNumber: input.recharge?.projectNumber ?? null,
          comment: input.comment,
          ...(autoApproved
            ? {
                approvedAt: createdAt,
                approvedById: user.id,
                approvalActingAs: 'system' as const,
                approvalAutoApproval: 'requester_is_approver' as const,
              }
            : {}),
          createdAt,
          ...plan.data,
        },
        include: travelDetailInclude,
      });
      await this.recordCreation(tx, created, user, viewer);
      await this.notifier.afterCreate(tx, created);
      return created;
    });
    return this.toDetailView(row, viewer, ability);
  }

  private async recordCreation(tx: PrismaTx, row: TravelRow, user: AuthUser, viewer: TravelViewer): Promise<void> {
    const label = travelReference(row.number);
    const actingAs: ActingAs =
      row.travellerId === user.id
        ? 'self'
        : viewer.isDesk
          ? 'back_office'
          : viewer.isAdmin && !viewer.treeIds.has(row.travellerId)
            ? 'admin'
            : 'requester';
    await this.audit.record(
      {
        module: 'travel',
        entityType: TRAVEL_ENTITY,
        entityId: row.id,
        action: 'create',
        actorId: user.id,
        actingAs,
        toState: row.approvalAutoApproval ? 'pending_approval' : row.status,
        metadata: {
          approvalReasons: row.approvalReasons,
          exemption: row.approvalExemption,
          approverSelection: row.approverSelection,
        },
        entityLabel: label,
        occurredAt: row.createdAt,
      },
      tx,
    );
    if (row.approvalAutoApproval === 'requester_is_approver') {
      await this.audit.record(
        {
          module: 'travel',
          entityType: TRAVEL_ENTITY,
          entityId: row.id,
          action: 'auto_approve',
          actorId: user.id,
          actingAs: 'system',
          fromState: 'pending_approval',
          toState: 'to_book',
          reason: 'requester_is_approver',
          metadata: { autoApproval: 'requester_is_approver' },
          entityLabel: label,
          occurredAt: new Date(row.createdAt.getTime() + 1),
        },
        tx,
      );
    }
  }

  /** Kind-specific validation and the nested create data. */
  private async planKind(
    input: CreateTravelRequestInput,
    ctx: { now: Date; backOffice: boolean; travellerId: string; add: (field: string, message: string) => void },
  ): Promise<KindPlan> {
    switch (input.kind) {
      case 'car':
        return this.planCar(input.car, ctx);
      case 'train':
        return this.planTrain(input.train, ctx);
      case 'flight':
        return this.planFlight(input.flight, ctx);
    }
  }

  private async planCar(
    car: CarInput,
    { now, backOffice, add }: { now: Date; backOffice: boolean; add: (f: string, m: string) => void },
  ): Promise<KindPlan> {
    const carClass = await this.prisma.carRentalClass.findUnique({ where: { id: car.carClassId } });
    if (!carClass?.active) add('car.carClassId', 'Choose an active car class.');
    else if (carClass.vehicleType !== car.vehicleType)
      add('car.carClassId', 'The class does not fit the vehicle type.');
    const pickupAt = new Date(car.pickupAt);
    const returnAt = new Date(car.returnAt);
    if (!backOffice && pickupAt <= now) add('car.pickupAt', 'The pickup must be in the future.');
    if (returnAt <= pickupAt) add('car.returnAt', 'The return must be after the pickup.');
    if (car.equipment.foreignTravel && car.foreignCountries.length === 0) {
      add('car.foreignCountries', 'Choose at least one country.');
    }
    if (car.vehicleType !== 'van' && car.minPayloadKg !== null)
      add('car.minPayloadKg', 'Only vans have a minimum payload.');
    if (car.handover.mode === 'branch' && !car.handover.branch) add('car.handover.branch', 'Enter the branch.');
    if (car.handover.mode === 'delivery' && !car.handover.address)
      add('car.handover.address', 'Enter the delivery address.');
    if (car.dropOff.mode === 'branch' && !car.dropOff.branch) add('car.dropOff.branch', 'Enter the branch.');
    if (car.dropOff.mode === 'collection' && !car.dropOff.address) {
      add('car.dropOff.address', 'Enter the collection address.');
    }
    if (!isAdultOn(car.driver.birthDate, isoDateInZone(pickupAt, this.clock.timeZone))) {
      add('car.driver.birthDate', 'The driver must be at least 18 years old at pickup.');
    }

    const handoverAddress = car.handover.mode === 'delivery' ? car.handover.address : null;
    const dropOffAddress = car.dropOff.mode === 'collection' ? car.dropOff.address : null;
    const reasons = evaluateApprovalReasons({
      kind: 'car',
      car: {
        classIsDefault: carClass?.isDefault ?? true,
        equipment: car.equipment,
        handoverMode: car.handover.mode,
        dropOffMode: car.dropOff.mode,
      },
    });
    return {
      startsAt: pickupAt,
      endsAt: returnAt,
      route: buildRoute({
        kind: 'car',
        car: {
          handoverMode: car.handover.mode,
          handoverBranch: car.handover.branch,
          handoverCity: handoverAddress?.city ?? null,
          destination: car.destination,
        },
      }),
      reasons,
      data: {
        car: {
          create: {
            vehicleType: car.vehicleType,
            carClassId: car.carClassId,
            pickupAt,
            returnAt,
            destination: car.destination,
            ...car.equipment,
            foreignCountries: car.equipment.foreignTravel ? [...new Set(car.foreignCountries)] : [],
            expectedKmPerDay: car.expectedKmPerDay,
            minPayloadKg: car.vehicleType === 'van' ? car.minPayloadKg : null,
            handoverMode: car.handover.mode,
            handoverBranch: car.handover.mode === 'branch' ? car.handover.branch : null,
            handoverStreet: handoverAddress?.street ?? null,
            handoverHouseNumber: handoverAddress?.houseNumber ?? null,
            handoverPostalCode: handoverAddress?.postalCode ?? null,
            handoverCity: handoverAddress?.city ?? null,
            handoverCountryCode: handoverAddress?.countryCode ?? null,
            dropOffMode: car.dropOff.mode,
            dropOffBranch: car.dropOff.mode === 'branch' ? car.dropOff.branch : null,
            dropOffStreet: dropOffAddress?.street ?? null,
            dropOffHouseNumber: dropOffAddress?.houseNumber ?? null,
            dropOffPostalCode: dropOffAddress?.postalCode ?? null,
            dropOffCity: dropOffAddress?.city ?? null,
            dropOffCountryCode: dropOffAddress?.countryCode ?? null,
            driverFirstName: car.driver.firstName,
            driverLastName: car.driver.lastName,
            driverEmail: car.driver.email.toLowerCase(),
            driverPhone: car.driver.phone,
            driverBirthDate: new Date(`${car.driver.birthDate}T00:00:00.000Z`),
            driverLicenceNumber: car.driver.licenceNumber,
            additionalDrivers: car.driver.additionalDrivers,
            specialEquipmentReason: car.specialEquipmentReason,
          },
        },
      },
    };
  }

  private async planTrain(
    train: TrainInput,
    ctx: { now: Date; backOffice: boolean; travellerId: string; add: (f: string, m: string) => void },
  ): Promise<KindPlan> {
    const { add } = ctx;
    const outboundAt = new Date(train.outboundAt);
    const returnAt = train.returnAt ? new Date(train.returnAt) : null;
    if (!ctx.backOffice && outboundAt <= ctx.now) add('train.outboundAt', 'The journey must start in the future.');
    if (train.tripType === 'return') {
      if (!returnAt) add('train.returnAt', 'Enter the return date and time.');
      else if (returnAt <= outboundAt) add('train.returnAt', 'The return must be after the outbound journey.');
    } else if (returnAt) {
      add('train.returnAt', 'A one-way journey has no return.');
    }

    const companionIds = train.companionIds;
    const seen = new Set<string>();
    const users = companionIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: companionIds } }, select: { id: true, active: true } })
      : [];
    companionIds.forEach((id, index) => {
      const field = `train.companionIds.${index}`;
      if (id === ctx.travellerId) add(field, 'The traveller is already on the booking.');
      else if (seen.has(id)) add(field, 'This colleague is already listed.');
      else if (!users.find((u) => u.id === id)?.active) add(field, 'Choose an active colleague.');
      seen.add(id);
    });

    return {
      startsAt: outboundAt,
      endsAt: train.tripType === 'return' ? returnAt : null,
      route: buildRoute({ kind: 'train', train }),
      reasons: evaluateApprovalReasons({ kind: 'train', train }),
      data: {
        train: {
          create: {
            tripType: train.tripType,
            outboundAt,
            returnAt: train.tripType === 'return' ? returnAt : null,
            fromStation: train.fromStation,
            viaStation: train.viaStation,
            toStation: train.toStation,
            fareType: train.fareType,
            seatReservations: train.seatReservations,
            separateTickets: train.separateTickets,
            localTransportTicket: train.localTransportTicket,
            notes: train.notes,
          },
        },
        companions: { create: companionIds.map((userId, position) => ({ userId, position })) },
      },
    };
  }

  private planFlight(
    flight: FlightInput,
    { now, backOffice, add }: { now: Date; backOffice: boolean; add: (f: string, m: string) => void },
  ): KindPlan {
    const outboundAt = new Date(flight.outboundDepartureAt);
    const returnAt = flight.returnDepartureAt ? new Date(flight.returnDepartureAt) : null;
    if (!backOffice && outboundAt <= now) add('flight.outboundDepartureAt', 'The flight must depart in the future.');
    if (flight.tripType === 'return') {
      if (!returnAt) add('flight.returnDepartureAt', 'Enter the return departure.');
      else if (returnAt <= outboundAt) add('flight.returnDepartureAt', 'The return must be after the outbound flight.');
      if (!flight.returnFrom) add('flight.returnFrom', 'Enter the return departure airport.');
      if (!flight.returnTo) add('flight.returnTo', 'Enter the return destination airport.');
    } else {
      if (returnAt) add('flight.returnDepartureAt', 'A one-way trip has no return flight.');
      if (flight.returnFrom) add('flight.returnFrom', 'A one-way trip has no return flight.');
      if (flight.returnTo) add('flight.returnTo', 'A one-way trip has no return flight.');
    }
    return {
      startsAt: outboundAt,
      endsAt: flight.tripType === 'return' ? returnAt : null,
      route: buildRoute({ kind: 'flight', flight }),
      reasons: evaluateApprovalReasons({ kind: 'flight' }),
      data: {
        flight: {
          create: {
            tripType: flight.tripType,
            outboundDepartureAt: outboundAt,
            outboundFrom: flight.outboundFrom,
            outboundTo: flight.outboundTo,
            returnDepartureAt: flight.tripType === 'return' ? returnAt : null,
            returnFrom: flight.tripType === 'return' ? flight.returnFrom : null,
            returnTo: flight.tripType === 'return' ? flight.returnTo : null,
            handLuggageOnly: flight.handLuggageOnly,
            notes: flight.notes,
          },
        },
      },
    };
  }
}
