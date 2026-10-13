import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import { type Paginated, paginate } from '@/common/http/pagination';
import { ProblemException } from '@/common/http/problem';
import type { SortField } from '@/common/http/sort';
import { Clock } from '@/common/time/clock.service';
import { PrismaService } from '@/database/prisma.service';
import type { PrismaTx } from '@/database/prisma.types';
import { Prisma } from '@/generated/prisma/client';
import { AuditService, type FieldChange } from '@/modules/core/audit/audit.service';
import { defaultActingAs } from '@/modules/core/workflow/workflow.service';
import type {
  AssetModelView,
  CreateDeviceTypeDto,
  CreateManufacturerDto,
  CreateModelDto,
  DeviceTypeView,
  ManufacturerView,
  PlatformView,
  UpdateDeviceTypeDto,
  UpdateManufacturerDto,
  UpdateModelDto,
} from '../dto/catalog.dto';

type CatalogEntity = 'device_type' | 'manufacturer' | 'platform' | 'asset_model';

const modelInclude = {
  manufacturer: true,
  deviceType: true,
  _count: { select: { assets: true } },
} as const satisfies Prisma.AssetModelInclude;
type ModelRow = Prisma.AssetModelGetPayload<{ include: typeof modelInclude }>;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Asset catalogue (SPEC §4.4, API.md §6.1): device types, manufacturers (with the device types
 * they make), platforms (with the device types they run on) and models. Every change is audited.
 * `assetCount` counts every asset referencing the row, including soft-deleted ones.
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  private async record(
    tx: PrismaTx,
    user: AuthUser,
    entityType: CatalogEntity,
    entityId: string,
    action: string,
    entityLabel: string,
    changes?: FieldChange[],
  ): Promise<void> {
    await this.audit.record(
      {
        module: 'assets',
        entityType,
        entityId,
        action,
        actorId: user.id,
        actingAs: defaultActingAs(user, 'assets'),
        changes: changes?.length ? changes : null,
        entityLabel,
      },
      tx,
    );
  }

  private async deviceTypeNames(ids: string[], db: PrismaTx): Promise<string> {
    if (!ids.length) return '';
    const rows = await db.deviceType.findMany({ where: { id: { in: ids } }, orderBy: { sortOrder: 'asc' } });
    return rows.map((r) => r.name).join(', ');
  }

  private async assertDeviceTypes(ids: string[], db: PrismaTx): Promise<void> {
    const unique = [...new Set(ids)];
    const found = await db.deviceType.count({ where: { id: { in: unique } } });
    if (found !== unique.length)
      throw ProblemException.fieldError('deviceTypeIds', 'Choose device types from the list.');
  }

  // --- device types --------------------------------------------------------------

  private async assetCountsByDeviceType(db: PrismaTx): Promise<Map<string, number>> {
    const groups = await db.asset.groupBy({ by: ['modelId'], _count: { _all: true } });
    const models = await db.assetModel.findMany({ select: { id: true, deviceTypeId: true } });
    const typeOf = new Map(models.map((m) => [m.id, m.deviceTypeId]));
    const counts = new Map<string, number>();
    for (const g of groups) {
      const type = typeOf.get(g.modelId);
      if (type) counts.set(type, (counts.get(type) ?? 0) + g._count._all);
    }
    return counts;
  }

  async deviceTypes(): Promise<DeviceTypeView[]> {
    const [rows, counts] = await Promise.all([
      this.prisma.deviceType.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      this.assetCountsByDeviceType(this.prisma),
    ]);
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      requiresPlatform: r.requiresPlatform,
      sortOrder: r.sortOrder,
      assetCount: counts.get(r.id) ?? 0,
    }));
  }

  private async deviceType(id: string, db: PrismaTx): Promise<DeviceTypeView> {
    const row = await db.deviceType.findUnique({ where: { id } });
    if (!row) throw ProblemException.notFound('Device type');
    const counts = await this.assetCountsByDeviceType(db);
    return { ...row, assetCount: counts.get(row.id) ?? 0 };
  }

  async createDeviceType(dto: CreateDeviceTypeDto, user: AuthUser): Promise<DeviceTypeView> {
    return this.prisma.$transaction(async (tx) => {
      if (await tx.deviceType.findUnique({ where: { code: dto.code } })) {
        throw ProblemException.fieldError('code', 'A device type with this code already exists.');
      }
      const row = await tx.deviceType.create({ data: dto });
      await this.record(tx, user, 'device_type', row.id, 'create', row.name);
      return this.deviceType(row.id, tx);
    });
  }

  async updateDeviceType(id: string, dto: UpdateDeviceTypeDto, user: AuthUser): Promise<DeviceTypeView> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.deviceType.findUnique({ where: { id } });
      if (!before) throw ProblemException.notFound('Device type');
      if (dto.code && dto.code !== before.code && (await tx.deviceType.findUnique({ where: { code: dto.code } }))) {
        throw ProblemException.fieldError('code', 'A device type with this code already exists.');
      }
      const changes = this.audit.diff('device_type', before, dto);
      if (changes.length) {
        const row = await tx.deviceType.update({ where: { id }, data: dto });
        await this.record(tx, user, 'device_type', id, 'update', row.name, changes);
      }
      return this.deviceType(id, tx);
    });
  }

  /** 409 `in_use` while any model references the type (SPEC §4.4). */
  async deleteDeviceType(id: string, user: AuthUser): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.deviceType.findUnique({ where: { id }, include: { _count: { select: { models: true } } } });
      if (!row) throw ProblemException.notFound('Device type');
      if (row._count.models > 0) {
        throw ProblemException.conflict(
          `${row.name} is used by ${row._count.models} model(s) and can't be deleted.`,
          'in_use',
        );
      }
      await tx.deviceType.delete({ where: { id } });
      await this.record(tx, user, 'device_type', id, 'delete', row.name);
    });
  }

  // --- manufacturers ---------------------------------------------------------------

  private manufacturerInclude = {
    deviceTypes: true,
    models: { select: { id: true, _count: { select: { assets: true } } } },
  } as const satisfies Prisma.ManufacturerInclude;

  private toManufacturer(
    row: Prisma.ManufacturerGetPayload<{ include: CatalogService['manufacturerInclude'] }>,
  ): ManufacturerView {
    return {
      id: row.id,
      name: row.name,
      deviceTypeIds: row.deviceTypes.map((d) => d.deviceTypeId),
      archived: row.archivedAt !== null,
      modelCount: row.models.length,
      assetCount: row.models.reduce((sum, m) => sum + m._count.assets, 0),
    };
  }

  async manufacturers(filter: { deviceTypeId?: string; includeArchived: boolean }): Promise<ManufacturerView[]> {
    const rows = await this.prisma.manufacturer.findMany({
      where: {
        ...(filter.includeArchived ? {} : { archivedAt: null }),
        ...(filter.deviceTypeId ? { deviceTypes: { some: { deviceTypeId: filter.deviceTypeId } } } : {}),
      },
      include: this.manufacturerInclude,
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => this.toManufacturer(r));
  }

  private async manufacturer(id: string, db: PrismaTx): Promise<ManufacturerView> {
    const row = await db.manufacturer.findUnique({ where: { id }, include: this.manufacturerInclude });
    if (!row) throw ProblemException.notFound('Manufacturer');
    return this.toManufacturer(row);
  }

  async createManufacturer(dto: CreateManufacturerDto, user: AuthUser): Promise<ManufacturerView> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertDeviceTypes(dto.deviceTypeIds, tx);
      const row = await tx.manufacturer
        .create({
          data: {
            name: dto.name,
            archivedAt: dto.archived ? this.clock.now() : null,
            deviceTypes: { create: [...new Set(dto.deviceTypeIds)].map((deviceTypeId) => ({ deviceTypeId })) },
          },
        })
        .catch((error: unknown) => {
          if (isUniqueViolation(error)) throw ProblemException.fieldError('name', 'This manufacturer already exists.');
          throw error;
        });
      await this.record(tx, user, 'manufacturer', row.id, 'create', row.name);
      return this.manufacturer(row.id, tx);
    });
  }

  async updateManufacturer(id: string, dto: UpdateManufacturerDto, user: AuthUser): Promise<ManufacturerView> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.manufacturer.findUnique({ where: { id }, include: { deviceTypes: true } });
      if (!before) throw ProblemException.notFound('Manufacturer');
      const beforeTypes = before.deviceTypes.map((d) => d.deviceTypeId);
      let nextTypes = beforeTypes;
      if (dto.deviceTypeIds) {
        await this.assertDeviceTypes(dto.deviceTypeIds, tx);
        nextTypes = [...new Set(dto.deviceTypeIds)];
        const removed = beforeTypes.filter((t) => !nextTypes.includes(t));
        const blocking = removed.length
          ? await tx.assetModel.findFirst({
              where: { manufacturerId: id, deviceTypeId: { in: removed } },
              include: { deviceType: true },
            })
          : null;
        if (blocking) {
          throw ProblemException.fieldError(
            'deviceTypeIds',
            `Models of this manufacturer are ${blocking.deviceType.name.toLowerCase()}s; keep that device type.`,
          );
        }
      }
      const changes = this.audit.diff(
        'manufacturer',
        {
          name: before.name,
          deviceTypes: await this.deviceTypeNames(beforeTypes, tx),
          archived: before.archivedAt !== null,
        },
        {
          name: dto.name ?? before.name,
          deviceTypes: await this.deviceTypeNames(nextTypes, tx),
          archived: dto.archived ?? before.archivedAt !== null,
        },
      );
      if (changes.length) {
        await tx.manufacturer
          .update({
            where: { id },
            data: {
              ...(dto.name ? { name: dto.name } : {}),
              ...(dto.archived !== undefined
                ? { archivedAt: dto.archived ? (before.archivedAt ?? this.clock.now()) : null }
                : {}),
              ...(dto.deviceTypeIds
                ? { deviceTypes: { deleteMany: {}, create: nextTypes.map((deviceTypeId) => ({ deviceTypeId })) } }
                : {}),
            },
          })
          .catch((error: unknown) => {
            if (isUniqueViolation(error))
              throw ProblemException.fieldError('name', 'This manufacturer already exists.');
            throw error;
          });
        await this.record(
          tx,
          user,
          'manufacturer',
          id,
          archiveAction(changes) ?? 'update',
          dto.name ?? before.name,
          changes,
        );
      }
      return this.manufacturer(id, tx);
    });
  }

  // --- platforms -------------------------------------------------------------------

  private platformInclude = {
    deviceTypes: true,
    _count: { select: { assets: true } },
  } as const satisfies Prisma.PlatformInclude;

  private toPlatform(row: Prisma.PlatformGetPayload<{ include: CatalogService['platformInclude'] }>): PlatformView {
    return {
      id: row.id,
      name: row.name,
      deviceTypeIds: row.deviceTypes.map((d) => d.deviceTypeId),
      archived: row.archivedAt !== null,
      assetCount: row._count.assets,
    };
  }

  async platforms(filter: { deviceTypeId?: string; includeArchived: boolean }): Promise<PlatformView[]> {
    const rows = await this.prisma.platform.findMany({
      where: {
        ...(filter.includeArchived ? {} : { archivedAt: null }),
        ...(filter.deviceTypeId ? { deviceTypes: { some: { deviceTypeId: filter.deviceTypeId } } } : {}),
      },
      include: this.platformInclude,
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => this.toPlatform(r));
  }

  private async platform(id: string, db: PrismaTx): Promise<PlatformView> {
    const row = await db.platform.findUnique({ where: { id }, include: this.platformInclude });
    if (!row) throw ProblemException.notFound('Platform');
    return this.toPlatform(row);
  }

  async createPlatform(dto: CreateManufacturerDto, user: AuthUser): Promise<PlatformView> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertDeviceTypes(dto.deviceTypeIds, tx);
      const row = await tx.platform
        .create({
          data: {
            name: dto.name,
            archivedAt: dto.archived ? this.clock.now() : null,
            deviceTypes: { create: [...new Set(dto.deviceTypeIds)].map((deviceTypeId) => ({ deviceTypeId })) },
          },
        })
        .catch((error: unknown) => {
          if (isUniqueViolation(error)) throw ProblemException.fieldError('name', 'This platform already exists.');
          throw error;
        });
      await this.record(tx, user, 'platform', row.id, 'create', row.name);
      return this.platform(row.id, tx);
    });
  }

  async updatePlatform(id: string, dto: UpdateManufacturerDto, user: AuthUser): Promise<PlatformView> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.platform.findUnique({ where: { id }, include: { deviceTypes: true } });
      if (!before) throw ProblemException.notFound('Platform');
      const beforeTypes = before.deviceTypes.map((d) => d.deviceTypeId);
      let nextTypes = beforeTypes;
      if (dto.deviceTypeIds) {
        await this.assertDeviceTypes(dto.deviceTypeIds, tx);
        nextTypes = [...new Set(dto.deviceTypeIds)];
        const removed = beforeTypes.filter((t) => !nextTypes.includes(t));
        const blocking = removed.length
          ? await tx.asset.findFirst({
              where: { platformId: id, model: { deviceTypeId: { in: removed } } },
              include: { model: { include: { deviceType: true } } },
            })
          : null;
        if (blocking) {
          throw ProblemException.fieldError(
            'deviceTypeIds',
            `Assets of type ${blocking.model.deviceType.name.toLowerCase()} run this platform; keep that device type.`,
          );
        }
      }
      const changes = this.audit.diff(
        'platform',
        {
          name: before.name,
          deviceTypes: await this.deviceTypeNames(beforeTypes, tx),
          archived: before.archivedAt !== null,
        },
        {
          name: dto.name ?? before.name,
          deviceTypes: await this.deviceTypeNames(nextTypes, tx),
          archived: dto.archived ?? before.archivedAt !== null,
        },
      );
      if (changes.length) {
        await tx.platform
          .update({
            where: { id },
            data: {
              ...(dto.name ? { name: dto.name } : {}),
              ...(dto.archived !== undefined
                ? { archivedAt: dto.archived ? (before.archivedAt ?? this.clock.now()) : null }
                : {}),
              ...(dto.deviceTypeIds
                ? { deviceTypes: { deleteMany: {}, create: nextTypes.map((deviceTypeId) => ({ deviceTypeId })) } }
                : {}),
            },
          })
          .catch((error: unknown) => {
            if (isUniqueViolation(error)) throw ProblemException.fieldError('name', 'This platform already exists.');
            throw error;
          });
        await this.record(
          tx,
          user,
          'platform',
          id,
          archiveAction(changes) ?? 'update',
          dto.name ?? before.name,
          changes,
        );
      }
      return this.platform(id, tx);
    });
  }

  // --- models ----------------------------------------------------------------------

  private toModel(row: ModelRow): AssetModelView {
    return {
      id: row.id,
      name: row.name,
      manufacturer: { id: row.manufacturer.id, name: row.manufacturer.name },
      deviceType: { id: row.deviceType.id, code: row.deviceType.code, name: row.deviceType.name },
      storageGb: row.storageGb,
      color: row.color,
      archived: row.archivedAt !== null,
      assetCount: row._count.assets,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async models(query: {
    page: number;
    perPage: number;
    deviceTypeId?: string;
    manufacturerId?: string;
    q?: string;
    includeArchived: boolean;
    sort: SortField[];
  }): Promise<Paginated<AssetModelView>> {
    const where: Prisma.AssetModelWhereInput = {
      ...(query.includeArchived ? {} : { archivedAt: null }),
      ...(query.deviceTypeId ? { deviceTypeId: query.deviceTypeId } : {}),
      ...(query.manufacturerId ? { manufacturerId: query.manufacturerId } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { manufacturer: { name: { contains: query.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const orderBy: Prisma.AssetModelOrderByWithRelationInput[] = [
      ...query.sort.map((s) =>
        s.field === 'assetCount' ? { assets: { _count: s.direction } } : { name: s.direction },
      ),
      { name: 'asc' },
      { id: 'asc' },
    ];
    const page = await paginate(
      query,
      (skip) => this.prisma.assetModel.findMany({ where, include: modelInclude, orderBy, ...skip }),
      () => this.prisma.assetModel.count({ where }),
    );
    return { data: page.data.map((r) => this.toModel(r)), meta: page.meta };
  }

  private async model(id: string, db: PrismaTx): Promise<AssetModelView> {
    const row = await db.assetModel.findUnique({ where: { id }, include: modelInclude });
    if (!row) throw ProblemException.notFound('Model');
    return this.toModel(row);
  }

  /** The manufacturer must make the device type (422) and not be archived (SPEC §4.4). */
  private async assertModelPair(manufacturerId: string, deviceTypeId: string, db: PrismaTx) {
    const [manufacturer, deviceType] = await Promise.all([
      db.manufacturer.findUnique({ where: { id: manufacturerId }, include: { deviceTypes: true } }),
      db.deviceType.findUnique({ where: { id: deviceTypeId } }),
    ]);
    if (!manufacturer) throw ProblemException.fieldError('manufacturerId', 'Choose a manufacturer from the catalogue.');
    if (!deviceType) throw ProblemException.fieldError('deviceTypeId', 'Choose a device type from the catalogue.');
    if (!manufacturer.deviceTypes.some((d) => d.deviceTypeId === deviceTypeId)) {
      throw ProblemException.fieldError(
        'deviceTypeId',
        `${manufacturer.name} does not make ${deviceType.name.toLowerCase()}s. Add the device type to the manufacturer first.`,
      );
    }
    return { manufacturer, deviceType };
  }

  private async assertModelNameFree(manufacturerId: string, name: string, exceptId: string | null, db: PrismaTx) {
    const taken = await db.assetModel.findFirst({
      where: {
        manufacturerId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
    });
    if (taken) throw ProblemException.fieldError('name', 'This manufacturer already has a model with this name.');
  }

  async createModel(dto: CreateModelDto, user: AuthUser): Promise<AssetModelView> {
    return this.prisma.$transaction(async (tx) => {
      const { manufacturer } = await this.assertModelPair(dto.manufacturerId, dto.deviceTypeId, tx);
      if (manufacturer.archivedAt) {
        throw ProblemException.fieldError('manufacturerId', 'This manufacturer is archived.');
      }
      await this.assertModelNameFree(dto.manufacturerId, dto.name, null, tx);
      const row = await tx.assetModel.create({
        data: {
          name: dto.name,
          manufacturerId: dto.manufacturerId,
          deviceTypeId: dto.deviceTypeId,
          storageGb: dto.storageGb ?? null,
          color: dto.color,
          archivedAt: dto.archived ? this.clock.now() : null,
          createdById: user.id,
        },
      });
      await this.record(tx, user, 'asset_model', row.id, 'create', row.name);
      return this.model(row.id, tx);
    });
  }

  async updateModel(id: string, dto: UpdateModelDto, user: AuthUser): Promise<AssetModelView> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.assetModel.findUnique({ where: { id }, include: modelInclude });
      if (!before) throw ProblemException.notFound('Model');
      const manufacturerId = dto.manufacturerId ?? before.manufacturerId;
      const deviceTypeId = dto.deviceTypeId ?? before.deviceTypeId;
      const pairChanged = manufacturerId !== before.manufacturerId || deviceTypeId !== before.deviceTypeId;
      let pair = { manufacturer: before.manufacturer, deviceType: before.deviceType };
      if (pairChanged) {
        if (before._count.assets > 0) {
          throw ProblemException.fieldError(
            dto.deviceTypeId && dto.deviceTypeId !== before.deviceTypeId ? 'deviceTypeId' : 'manufacturerId',
            `This model is used by ${before._count.assets} asset(s); its manufacturer and device type can't change.`,
          );
        }
        pair = await this.assertModelPair(manufacturerId, deviceTypeId, tx);
      }
      const name = dto.name ?? before.name;
      if (name !== before.name || manufacturerId !== before.manufacturerId) {
        await this.assertModelNameFree(manufacturerId, name, id, tx);
      }
      const after = {
        name,
        manufacturer: pair.manufacturer.name,
        deviceType: pair.deviceType.name,
        storageGb: dto.storageGb !== undefined ? dto.storageGb : before.storageGb,
        color: dto.color !== undefined ? dto.color : before.color,
        archived: dto.archived ?? before.archivedAt !== null,
      };
      const changes = this.audit.diff(
        'asset_model',
        {
          name: before.name,
          manufacturer: before.manufacturer.name,
          deviceType: before.deviceType.name,
          storageGb: before.storageGb,
          color: before.color,
          archived: before.archivedAt !== null,
        },
        after,
      );
      if (changes.length) {
        await tx.assetModel.update({
          where: { id },
          data: {
            name,
            manufacturerId,
            deviceTypeId,
            storageGb: after.storageGb ?? null,
            color: after.color ?? null,
            archivedAt: after.archived ? (before.archivedAt ?? this.clock.now()) : null,
          },
        });
        await this.record(tx, user, 'asset_model', id, archiveAction(changes) ?? 'update', name, changes);
      }
      return this.model(id, tx);
    });
  }

  /** Hard delete only when no asset (including soft-deleted ones) uses the model -> else 409 `model_in_use`. */
  async deleteModel(id: string, user: AuthUser): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.assetModel.findUnique({ where: { id }, include: modelInclude });
      if (!row) throw ProblemException.notFound('Model');
      if (row._count.assets > 0) {
        throw ProblemException.conflict(
          `${row.name} is in use by ${row._count.assets} asset(s). Archive it instead.`,
          'model_in_use',
          { assetCount: row._count.assets },
        );
      }
      await tx.assetModel.delete({ where: { id } });
      await this.record(tx, user, 'asset_model', id, 'delete', row.name);
    });
  }
}

/** A change that only toggles `archived` is recorded as `archive` / `restore`. */
function archiveAction(changes: FieldChange[]): 'archive' | 'restore' | null {
  if (changes.length !== 1 || changes[0].field !== 'archived') return null;
  return changes[0].to ? 'archive' : 'restore';
}
