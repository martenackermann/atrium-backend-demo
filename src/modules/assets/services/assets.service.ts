import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import type { AppAbility } from '@/common/authz/ability.types';
import { toUserRefOrNull } from '@/common/domain/mappers';
import { type Paginated, paginate, type PaginationQuery } from '@/common/http/pagination';
import { ProblemException } from '@/common/http/problem';
import { toPrismaOrderBy } from '@/common/http/sort';
import { Clock } from '@/common/time/clock.service';
import { dateFromIso, isoFromDateOrNull } from '@/common/time/time';
import { PrismaService } from '@/database/prisma.service';
import type { PrismaTx } from '@/database/prisma.types';
import { Prisma } from '@/generated/prisma/client';
import { AuditService, type TimelineEntryView } from '@/modules/core/audit/audit.service';
import { defaultActingAs, WorkflowService } from '@/modules/core/workflow/workflow.service';
import { isAssetAdmin } from '../abilities/assets.abilities';
import { ACTIVE_STATUSES, assetTag, costCenterLabel, DELETABLE_STATUSES, parseAssetTag } from '../assets.domain';
import type {
  AssetAssignmentView,
  AssetFilter,
  AssetListItemView,
  AssetView,
  CreateAssetDto,
  UpdateAssetDto,
} from '../dto/asset.dto';
import { AssetWorkflow } from '../machines/asset.workflow';
import { AssetActionsService } from './asset-actions.service';
import {
  assetInclude,
  assetLabel,
  type AssetRow,
  assignmentInclude,
  openAssignmentOf,
  toAssignmentView,
  toListItemView,
} from './asset.mapper';
import { withAssignees } from './asset-timeline';

/** Values compared for the field-level audit diff (labels in ASSET_AUDIT_LABELS.asset). */
interface AssetAuditView extends Record<string, unknown> {
  serialNumber: string;
  name: string | null;
  model: string;
  platform: string | null;
  purchaseDate: string | null;
  costCenter: string;
  mdmEnrolled: boolean;
  notes: string | null;
}

function auditView(row: {
  serialNumber: string;
  name: string | null;
  model: { name: string };
  platform: { name: string } | null;
  purchaseDate: Date | null;
  costCenter: { code: string; name: string };
  mdmEnrolled: boolean;
  notes: string | null;
}): AssetAuditView {
  return {
    serialNumber: row.serialNumber,
    name: row.name,
    model: row.model.name,
    platform: row.platform?.name ?? null,
    purchaseDate: isoFromDateOrNull(row.purchaseDate),
    costCenter: costCenterLabel(row.costCenter),
    mdmEnrolled: row.mdmEnrolled,
    notes: row.notes,
  };
}

const SORT_FIELD_MAP = { assetTag: 'number', model: 'model.name' };
const EXPORT_LIMIT = 10_000;

/** Assets: list/detail/create/edit/delete, "my devices", history, timeline and CSV export (API.md §6). */
@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly workflows: WorkflowService,
    private readonly workflow: AssetWorkflow,
    private readonly actions: AssetActionsService,
    private readonly clock: Clock,
  ) {}

  // --- reads -------------------------------------------------------------------

  /** Prisma filter for the admin list and the export (API.md §6.1 query). */
  where(filter: AssetFilter): Prisma.AssetWhereInput {
    const and: Prisma.AssetWhereInput[] = [];
    if (!filter.includeDeleted) and.push({ deletedAt: null });
    if (filter.status.length) and.push({ status: { in: filter.status } });
    if (filter.deviceTypeId.length) and.push({ model: { deviceTypeId: { in: filter.deviceTypeId } } });
    if (filter.manufacturerId.length) and.push({ model: { manufacturerId: { in: filter.manufacturerId } } });
    if (filter.modelId.length) and.push({ modelId: { in: filter.modelId } });
    if (filter.platformId.length) and.push({ platformId: { in: filter.platformId } });
    if (filter.assignedUserId.length) and.push({ assignedUserId: { in: filter.assignedUserId } });
    if (filter.costCenterId.length) and.push({ costCenterId: { in: filter.costCenterId } });
    if (filter.from) and.push({ purchaseDate: { gte: dateFromIso(filter.from) } });
    if (filter.to) and.push({ purchaseDate: { lte: dateFromIso(filter.to) } });
    if (filter.q) {
      const tag = parseAssetTag(filter.q);
      const text = { contains: filter.q, mode: 'insensitive' } as const;
      and.push(
        tag !== null
          ? { number: tag }
          : {
              OR: [
                { serialNumber: text },
                { name: text },
                { assignedUser: { displayName: text } },
                { assignedUser: { email: text } },
              ],
            },
      );
    }
    return { AND: and };
  }

  private orderBy(filter: AssetFilter): Prisma.AssetOrderByWithRelationInput[] {
    return [...(toPrismaOrderBy(filter.sort, SORT_FIELD_MAP) as Prisma.AssetOrderByWithRelationInput[]), { id: 'asc' }];
  }

  async list(
    query: AssetFilter & PaginationQuery,
    user: AuthUser,
    ability: AppAbility,
  ): Promise<Paginated<AssetListItemView>> {
    const where = this.where(query);
    const page = await paginate(
      query,
      (skip) => this.prisma.asset.findMany({ where, include: assetInclude, orderBy: this.orderBy(query), ...skip }),
      () => this.prisma.asset.count({ where }),
    );
    return { data: await this.listItems(page.data, user, ability), meta: page.meta };
  }

  async listItems(rows: AssetRow[], user: AuthUser, ability: AppAbility): Promise<AssetListItemView[]> {
    return Promise.all(rows.map(async (row) => toListItemView(row, await this.actions.for(row, user, ability))));
  }

  /** Detail DTO; notes only for admins (SPEC §3.3). */
  async toDto(row: AssetRow, user: AuthUser, ability: AppAbility, db: PrismaTx = this.prisma): Promise<AssetView> {
    const [availableActions, platforms] = await Promise.all([
      this.actions.for(row, user, ability, db),
      this.applicablePlatforms(row.model.deviceTypeId, db),
    ]);
    const open = openAssignmentOf(row);
    return {
      ...toListItemView(row, availableActions),
      notes: isAssetAdmin(user) ? row.notes : null,
      currentAssignment: open ? toAssignmentView(open) : null,
      applicablePlatforms: platforms,
      createdBy: toUserRefOrNull(row.createdBy),
      createdAt: row.createdAt.toISOString(),
      version: row.version,
    };
  }

  private async applicablePlatforms(deviceTypeId: string, db: PrismaTx): Promise<{ id: string; name: string }[]> {
    return db.platform.findMany({
      where: { archivedAt: null, deviceTypes: { some: { deviceTypeId } } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  /** Row the user may see (admins: all incl. deleted; users: their own). Null -> 404. */
  async findVisible(id: string, user: AuthUser, db: PrismaTx = this.prisma): Promise<AssetRow | null> {
    const row = await db.asset.findUnique({ where: { id }, include: assetInclude });
    if (!row) return null;
    if (isAssetAdmin(user)) return row;
    return row.assignedUserId === user.id && row.deletedAt === null ? row : null;
  }

  async detail(id: string, user: AuthUser, ability: AppAbility): Promise<AssetView> {
    const row = await this.findVisible(id, user);
    if (!row) throw ProblemException.notFound('Asset');
    return this.toDto(row, user, ability);
  }

  /** `GET /assets/mine`: pending = waiting for my acceptance; active = in use or in repair while assigned to me. */
  async mine(user: AuthUser, ability: AppAbility): Promise<{ pending: AssetView[]; active: AssetView[] }> {
    const rows = await this.prisma.asset.findMany({
      where: {
        assignedUserId: user.id,
        deletedAt: null,
        status: { in: ['pending_acceptance', ...ACTIVE_STATUSES] },
      },
      include: assetInclude,
      orderBy: [{ updatedAt: 'desc' }, { number: 'asc' }],
    });
    const views = await Promise.all(rows.map((row) => this.toDto(row, user, ability)));
    return {
      pending: views.filter((v) => v.status === 'pending_acceptance'),
      active: views.filter((v) => v.status !== 'pending_acceptance'),
    };
  }

  /** Admin-only sub-resources: the assigned user gets 403 (they can see the asset), others 404. */
  private async requireAdminView(id: string, user: AuthUser): Promise<AssetRow> {
    const row = await this.findVisible(id, user);
    if (!row) throw ProblemException.notFound('Asset');
    if (!isAssetAdmin(user)) throw ProblemException.forbidden('Only asset admins can see the history of a device.');
    return row;
  }

  async assignments(id: string, user: AuthUser): Promise<AssetAssignmentView[]> {
    await this.requireAdminView(id, user);
    const rows = await this.prisma.assetAssignment.findMany({
      where: { assetId: id },
      include: assignmentInclude,
      orderBy: [{ assignedAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toAssignmentView);
  }

  /** Field-level diffs, transitions, reminders and cost-centre syncs, oldest first (SPEC_RESOLUTIONS #24). */
  async timeline(id: string, user: AuthUser): Promise<TimelineEntryView[]> {
    const row = await this.requireAdminView(id, user);
    const [entries, assignments] = await Promise.all([
      this.audit.timeline([{ entityType: 'asset', entityId: id }], () => assetLabel(row)),
      this.prisma.assetAssignment.findMany({ where: { assetId: id }, include: { user: true } }),
    ]);
    return withAssignees(entries, assignments);
  }

  // --- writes ------------------------------------------------------------------

  private async assertSerialFree(serialNumber: string, exceptId: string | null, db: PrismaTx): Promise<void> {
    const taken = await db.asset.findFirst({
      where: {
        serialNumber: { equals: serialNumber, mode: 'insensitive' },
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (taken) throw ProblemException.conflict(`Serial number ${serialNumber} is already registered.`, 'serial_taken');
  }

  private async activeModel(modelId: string, db: PrismaTx, field = 'modelId') {
    const model = await db.assetModel.findUnique({ where: { id: modelId }, include: { deviceType: true } });
    if (!model) throw ProblemException.fieldError(field, 'Choose a model from the catalogue.');
    if (model.archivedAt) throw ProblemException.fieldError(field, 'This model is archived. Choose an active model.');
    return model;
  }

  private async applicablePlatform(platformId: string, deviceTypeId: string, db: PrismaTx, allowArchived = false) {
    const platform = await db.platform.findFirst({
      where: {
        id: platformId,
        ...(allowArchived ? {} : { archivedAt: null }),
        deviceTypes: { some: { deviceTypeId } },
      },
    });
    if (!platform)
      throw ProblemException.fieldError('platformId', 'This platform is not available for this device type.');
    return platform;
  }

  private async activeCostCenter(costCenterId: string, db: PrismaTx) {
    const cc = await db.costCenter.findUnique({ where: { id: costCenterId } });
    if (!cc?.active) throw ProblemException.fieldError('costCenterId', 'Choose an active cost centre.');
    return cc;
  }

  async create(dto: CreateAssetDto, user: AuthUser, ability: AppAbility): Promise<AssetView> {
    const id = await this.prisma.$transaction(async (tx) => {
      const model = await this.activeModel(dto.modelId, tx);
      const platform = dto.platformId ? await this.applicablePlatform(dto.platformId, model.deviceTypeId, tx) : null;
      const costCenterId = dto.costCenterId
        ? (await this.activeCostCenter(dto.costCenterId, tx)).id
        : await this.workflow.defaultCostCenterId(tx);
      if (dto.assignToUserId) {
        const assignee = await tx.user.findUnique({ where: { id: dto.assignToUserId } });
        if (!assignee?.active) throw ProblemException.fieldError('assignToUserId', 'Choose an active user.');
      }
      await this.assertSerialFree(dto.serialNumber, null, tx);

      const row = await tx.asset
        .create({
          data: {
            serialNumber: dto.serialNumber,
            name: dto.name,
            modelId: model.id,
            platformId: platform?.id ?? null,
            status: 'in_stock',
            costCenterId,
            purchaseDate: dto.purchaseDate ? dateFromIso(dto.purchaseDate) : null,
            mdmEnrolled: dto.mdmEnrolled ?? false,
            notes: dto.notes,
            createdById: user.id,
            updatedById: user.id,
          },
          include: assetInclude,
        })
        .catch((error: unknown) => {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            throw ProblemException.conflict(`Serial number ${dto.serialNumber} is already registered.`, 'serial_taken');
          }
          throw error;
        });
      await this.audit.record(
        {
          module: 'assets',
          entityType: 'asset',
          entityId: row.id,
          action: 'create',
          actorId: user.id,
          actingAs: defaultActingAs(user, 'assets'),
          toState: 'in_stock',
          entityLabel: assetLabel(row),
        },
        tx,
      );
      return row.id;
    });

    // SPEC §5.3: "If assignToUserId is given on create, assign is applied immediately".
    if (dto.assignToUserId) {
      await this.workflows.apply(this.workflow.definition, {
        id,
        action: 'assign',
        actor: user,
        ability,
        input: { userId: dto.assignToUserId },
      });
    }
    return this.detail(id, user, ability);
  }

  async update(id: string, dto: UpdateAssetDto, user: AuthUser, ability: AppAbility): Promise<AssetView> {
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await this.workflow.load(tx, id, user);
      if (!current) throw ProblemException.notFound('Asset');
      if (!this.actions.canEdit(current, ability)) {
        if (current.deletedAt !== null || current.status === 'scrapped') {
          throw ProblemException.invalidTransition('edit', current.deletedAt ? 'deleted' : current.status);
        }
        throw ProblemException.forbidden();
      }
      if (dto.version !== undefined && dto.version !== current.version) throw ProblemException.versionConflict();

      const data: Prisma.AssetUncheckedUpdateManyInput = {};
      const next = {
        serialNumber: current.serialNumber,
        name: current.name,
        model: current.model,
        platform: current.platform as { id: string; name: string } | null,
        purchaseDate: current.purchaseDate,
        costCenter: current.costCenter,
        mdmEnrolled: current.mdmEnrolled,
        notes: current.notes,
      };

      if (dto.serialNumber !== undefined && dto.serialNumber !== current.serialNumber) {
        await this.assertSerialFree(dto.serialNumber, current.id, tx);
        data.serialNumber = next.serialNumber = dto.serialNumber;
      }
      if (dto.name !== undefined) data.name = next.name = dto.name;
      let deviceTypeId = current.model.deviceTypeId;
      if (dto.modelId !== undefined && dto.modelId !== current.modelId) {
        const model = await this.activeModel(dto.modelId, tx);
        const full = await tx.assetModel.findUniqueOrThrow({
          where: { id: model.id },
          include: { manufacturer: true, deviceType: true },
        });
        data.modelId = model.id;
        next.model = full;
        deviceTypeId = model.deviceTypeId;
      }
      if (dto.platformId !== undefined && dto.platformId !== current.platformId) {
        next.platform = dto.platformId ? await this.applicablePlatform(dto.platformId, deviceTypeId, tx) : null;
        data.platformId = next.platform?.id ?? null;
      } else if (next.platform && deviceTypeId !== current.model.deviceTypeId) {
        // A model change must keep the installed platform valid for the new device type.
        await this.applicablePlatform(next.platform.id, deviceTypeId, tx, true);
      }
      if (dto.purchaseDate !== undefined) {
        data.purchaseDate = next.purchaseDate = dto.purchaseDate ? dateFromIso(dto.purchaseDate) : null;
      }
      if (dto.costCenterId !== undefined) {
        const targetId = dto.costCenterId ?? (await this.workflow.defaultCostCenterId(tx));
        if (targetId !== current.costCenterId) {
          // SPEC_RESOLUTIONS #22: the cost centre follows the assigned user while the asset is assigned.
          if (current.assignedUserId) {
            throw ProblemException.fieldError(
              'costCenterId',
              "The cost centre follows the assigned user and can't be changed while the asset is assigned.",
            );
          }
          next.costCenter = await this.activeCostCenter(targetId, tx);
          data.costCenterId = targetId;
        }
      }
      if (dto.mdmEnrolled !== undefined) data.mdmEnrolled = next.mdmEnrolled = dto.mdmEnrolled;
      if (dto.notes !== undefined) data.notes = next.notes = dto.notes;

      const changes = this.audit.diff<AssetAuditView>('asset', auditView(current), auditView(next));
      if (changes.length === 0) return current;

      const updated = await tx.asset.updateMany({
        where: { id: current.id, version: current.version },
        data: { ...data, updatedById: user.id, version: { increment: 1 } },
      });
      if (updated.count === 0) throw ProblemException.versionConflict();
      await this.audit.record(
        {
          module: 'assets',
          entityType: 'asset',
          entityId: current.id,
          action: 'update',
          actorId: user.id,
          actingAs: defaultActingAs(user, 'assets'),
          changes,
          entityLabel: assetLabel({ number: current.number, model: next.model }),
        },
        tx,
      );
      return tx.asset.findUniqueOrThrow({ where: { id: current.id }, include: assetInclude });
    });
    return this.toDto(row, user, ability);
  }

  /** Soft delete, only in_stock or scrapped (SPEC §4.4). */
  async remove(id: string, user: AuthUser, ability: AppAbility): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const row = await this.workflow.load(tx, id, user);
      if (!row) throw ProblemException.notFound('Asset');
      if (!this.actions.canDelete(row, ability)) {
        if (row.deletedAt !== null || !DELETABLE_STATUSES.includes(row.status)) {
          throw ProblemException.invalidTransition('delete', row.deletedAt ? 'deleted' : row.status);
        }
        throw ProblemException.forbidden();
      }
      await tx.asset.update({
        where: { id },
        data: { deletedAt: this.clock.now(), deletedById: user.id, updatedById: user.id, version: { increment: 1 } },
      });
      await this.audit.record(
        {
          module: 'assets',
          entityType: 'asset',
          entityId: id,
          action: 'delete',
          actorId: user.id,
          actingAs: defaultActingAs(user, 'assets'),
          fromState: row.status,
          toState: row.status,
          entityLabel: assetLabel(row),
        },
        tx,
      );
    });
  }

  // --- export ------------------------------------------------------------------

  /** CSV with BOM, comma separator, ISO dates (API.md §1 CSV exports); same filters as the list. */
  async exportCsv(filter: AssetFilter): Promise<string> {
    const rows = await this.prisma.asset.findMany({
      where: this.where(filter),
      include: assetInclude,
      orderBy: this.orderBy(filter),
      take: EXPORT_LIMIT,
    });
    const header = [
      'Asset tag',
      'Serial number',
      'Device name',
      'Device type',
      'Manufacturer',
      'Model',
      'Platform',
      'Status',
      'Assigned user',
      'Assigned user email',
      'Cost centre',
      'Purchase date',
      'MDM enrolled',
      'Deleted at',
      'Updated at',
    ];
    const lines = rows.map((r) =>
      [
        assetTag(r.number),
        r.serialNumber,
        r.name,
        r.model.deviceType.name,
        r.model.manufacturer.name,
        r.model.name,
        r.platform?.name,
        r.status,
        r.assignedUser?.displayName,
        r.assignedUser?.email,
        r.costCenter.code,
        isoFromDateOrNull(r.purchaseDate),
        r.mdmEnrolled ? 'yes' : 'no',
        r.deletedAt?.toISOString(),
        r.updatedAt.toISOString(),
      ]
        .map(csvCell)
        .join(','),
    );
    return `${BOM}${[header.map(csvCell).join(','), ...lines].join('\r\n')}\r\n`;
  }
}

/** UTF-8 byte order mark so spreadsheet apps detect the encoding. */
const BOM = String.fromCharCode(0xfeff);

function csvCell(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  // Neutralise spreadsheet formulas and quote when needed.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
