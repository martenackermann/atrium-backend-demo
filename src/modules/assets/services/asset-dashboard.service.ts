import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import type { AppAbility } from '@/common/authz/ability.types';
import { Clock } from '@/common/time/clock.service';
import { AppConfig } from '@/config/app-config';
import { PrismaService } from '@/database/prisma.service';
import { AuditService } from '@/modules/core/audit/audit.service';
import { isAssetAdmin } from '../abilities/assets.abilities';
import {
  ASSET_STATUSES,
  type AssetStatusValue,
  assetTag,
  OPEN_ASSIGNMENT_WHERE,
  overdueAssignedBefore,
} from '../assets.domain';
import type { AssetDashboardView } from '../dto/asset.dto';
import { assetInclude, openAssignmentOf } from './asset.mapper';
import { withAssignees } from './asset-timeline';
import { AssetsService } from './assets.service';

const RECENT_ACTIVITY = 10;
const OLDEST_PENDING = 5;

/** `GET /assets/dashboard` and `GET /assets/queues/counts` (API.md §6.1). Soft-deleted assets are excluded. */
@Injectable()
export class AssetDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly assets: AssetsService,
    private readonly config: AppConfig,
    private readonly clock: Clock,
  ) {}

  /** Pending (open, not accepted) assignments counted as overdue (SPEC_RESOLUTIONS #23). */
  private overdueWhere() {
    const before = overdueAssignedBefore(
      this.clock.today(),
      this.config.get('ASSET_ACCEPTANCE_DUE_DAYS'),
      this.clock.timeZone,
    );
    return {
      status: 'pending_acceptance' as const,
      deletedAt: null,
      assignments: { some: { ...OPEN_ASSIGNMENT_WHERE, acceptedAt: null, assignedAt: { lt: before } } },
    };
  }

  async counts(user: AuthUser) {
    const mine = await this.prisma.asset.count({
      where: { assignedUserId: user.id, status: 'pending_acceptance', deletedAt: null },
    });
    if (!isAssetAdmin(user)) return { mine: { pending: mine }, admin: null };
    const [pendingAcceptance, acceptanceOverdue, inRepair, inStock] = await Promise.all([
      this.prisma.asset.count({ where: { status: 'pending_acceptance', deletedAt: null } }),
      this.prisma.asset.count({ where: this.overdueWhere() }),
      this.prisma.asset.count({ where: { status: 'in_repair', deletedAt: null } }),
      this.prisma.asset.count({ where: { status: 'in_stock', deletedAt: null } }),
    ]);
    return { mine: { pending: mine }, admin: { pendingAcceptance, acceptanceOverdue, inRepair, inStock } };
  }

  async dashboard(user: AuthUser, ability: AppAbility): Promise<AssetDashboardView> {
    const [groups, models, deviceTypes, manufacturers, pendingRows, overdue, auditRows] = await Promise.all([
      this.prisma.asset.groupBy({ by: ['modelId', 'status'], where: { deletedAt: null }, _count: { _all: true } }),
      this.prisma.assetModel.findMany({ select: { id: true, deviceTypeId: true, manufacturerId: true } }),
      this.prisma.deviceType.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      this.prisma.manufacturer.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.asset.findMany({
        where: { status: 'pending_acceptance', deletedAt: null },
        include: assetInclude,
      }),
      this.prisma.asset.count({ where: this.overdueWhere() }),
      this.prisma.auditLog.findMany({
        where: { entityType: 'asset' },
        include: { actor: true },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: RECENT_ACTIVITY,
      }),
    ]);

    const modelById = new Map(models.map((m) => [m.id, m]));
    const byStatus = Object.fromEntries(ASSET_STATUSES.map((s) => [s, 0])) as Record<AssetStatusValue, number>;
    const typeCounts = new Map<string, { total: number; inUse: number; inStock: number }>();
    const manufacturerCounts = new Map<string, number>();
    for (const group of groups) {
      const n = group._count._all;
      byStatus[group.status] += n;
      const model = modelById.get(group.modelId);
      if (!model) continue;
      const t = typeCounts.get(model.deviceTypeId) ?? { total: 0, inUse: 0, inStock: 0 };
      t.total += n;
      if (group.status === 'in_use') t.inUse += n;
      if (group.status === 'in_stock') t.inStock += n;
      typeCounts.set(model.deviceTypeId, t);
      manufacturerCounts.set(model.manufacturerId, (manufacturerCounts.get(model.manufacturerId) ?? 0) + n);
    }

    const oldest = pendingRows
      .sort(
        (a, b) =>
          (openAssignmentOf(a)?.assignedAt.getTime() ?? 0) - (openAssignmentOf(b)?.assignedAt.getTime() ?? 0) ||
          a.number - b.number,
      )
      .slice(0, OLDEST_PENDING);
    // "Waiting since" is the assignment date; updatedAt also moves with reminders and edits.
    const oldestItems = (await this.assets.listItems(oldest, user, ability)).map((item, index) => ({
      ...item,
      assignedAt: (openAssignmentOf(oldest[index])?.assignedAt ?? oldest[index].updatedAt).toISOString(),
    }));

    const auditedIds = [...new Set(auditRows.map((r) => r.entityId))];
    const [auditedAssets, assignments] = await Promise.all([
      this.prisma.asset.findMany({ where: { id: { in: auditedIds } }, include: { model: true } }),
      this.prisma.assetAssignment.findMany({ where: { assetId: { in: auditedIds } }, include: { user: true } }),
    ]);
    const assetById = new Map(auditedAssets.map((a) => [a.id, a]));
    const entries = withAssignees(
      auditRows.map((row) => this.audit.toTimelineEntry(row)),
      assignments,
    );

    return {
      totals: { all: Object.values(byStatus).reduce((a, b) => a + b, 0), byStatus },
      byDeviceType: deviceTypes.map((t) => ({
        deviceType: { id: t.id, code: t.code, name: t.name },
        ...(typeCounts.get(t.id) ?? { total: 0, inUse: 0, inStock: 0 }),
      })),
      byManufacturer: manufacturers
        .map((m) => ({ manufacturer: { id: m.id, name: m.name }, total: manufacturerCounts.get(m.id) ?? 0 }))
        .filter((m) => m.total > 0)
        .sort((a, b) => b.total - a.total || a.manufacturer.name.localeCompare(b.manufacturer.name)),
      pendingAcceptance: {
        total: pendingRows.length,
        overdue,
        oldest: oldestItems,
      },
      recentActivity: entries.flatMap((entry) => {
        const asset = assetById.get(entry.entityId);
        return asset
          ? [{ ...entry, asset: { id: asset.id, assetTag: assetTag(asset.number), model: asset.model.name } }]
          : [];
      }),
    };
  }
}
