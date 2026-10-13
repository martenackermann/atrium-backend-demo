import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import { Clock } from '@/common/time/clock.service';
import { AppConfig } from '@/config/app-config';
import { PrismaService } from '@/database/prisma.service';
import {
  type InboxItem,
  inboxItemId,
  type InboxProvider,
  RegisterInboxProvider,
} from '@/modules/core/contracts/inbox.contract';
import { acceptanceDueAt, assetTag, deviceNoun, OPEN_ASSIGNMENT_WHERE } from '../assets.domain';

/** Reminder count from which the acceptance to-do is high priority (API.md §8). */
const HIGH_PRIORITY_REMINDERS = 2;

/** API.md §8 `assets.acceptance_required`: devices waiting for my acceptance. */
@Injectable()
@RegisterInboxProvider()
export class AssetsInboxProvider implements InboxProvider {
  readonly module = 'assets' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly clock: Clock,
  ) {}

  async items(user: AuthUser): Promise<InboxItem[]> {
    const rows = await this.prisma.assetAssignment.findMany({
      where: {
        userId: user.id,
        acceptedAt: null,
        ...OPEN_ASSIGNMENT_WHERE,
        asset: { status: 'pending_acceptance', deletedAt: null, assignedUserId: user.id },
      },
      include: { asset: { include: { model: { include: { deviceType: true } } } } },
      orderBy: { assignedAt: 'asc' },
    });
    const dueDays = this.config.get('ASSET_ACCEPTANCE_DUE_DAYS');
    return rows.map((a) => ({
      id: inboxItemId('assets.acceptance_required', a.assetId),
      module: 'assets',
      type: 'assets.acceptance_required',
      reference: assetTag(a.asset.number),
      title: `Confirm your new ${deviceNoun(a.asset.model.deviceType.name)}`,
      subtitle: `${a.asset.model.name} · ${assetTag(a.asset.number)}`,
      dueAt: acceptanceDueAt(a.assignedAt, dueDays, this.clock.timeZone).toISOString(),
      priority: a.reminderCount >= HIGH_PRIORITY_REMINDERS ? 'high' : 'normal',
      actingAs: null,
      link: `/assets/${a.assetId}`,
      actionsPath: null,
      entityId: a.assetId,
      createdAt: a.assignedAt.toISOString(),
      quickActions: [],
    }));
  }
}
