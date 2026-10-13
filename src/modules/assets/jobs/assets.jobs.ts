import { Injectable } from '@nestjs/common';
import { Clock } from '@/common/time/clock.service';
import { addDaysIso, isoDateInZone, startOfDayInZone } from '@/common/time/time';
import { AppConfig } from '@/config/app-config';
import { PrismaService } from '@/database/prisma.service';
import { AuditService } from '@/modules/core/audit/audit.service';
import { type JobRunContext, type JobSummary, ScheduledJob } from '@/modules/core/jobs/scheduled-job.decorator';
import { NotificationService } from '@/modules/core/notifications/notification.service';
import { ACTIVE_STATUSES, assetTag, costCenterLabel, deviceNoun, OPEN_ASSIGNMENT_WHERE } from '../assets.domain';
import { acceptanceReminderNotification } from '../mail/acceptance-reminder.notification';
import { assetLabel } from '../services/asset.mapper';

/** Reminders are high priority from this reminder number on (SPEC §7). */
const HIGH_PRIORITY_REMINDER = 2;

/** SPEC §8 jobs of the assets module. Both are idempotent. */
@Injectable()
export class AssetsJobs {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly config: AppConfig,
    private readonly clock: Clock,
  ) {}

  /**
   * Nightly: copies the assigned user's cost centre onto devices they accepted (in use or in repair)
   * where it differs (SPEC_RESOLUTIONS #22), with an audited field diff.
   */
  @ScheduledJob({
    name: 'assets.cost-center-sync',
    slice: 'A3',
    cronEnv: 'CRON_ASSETS_COST_CENTER',
    description: "Copies the assigned user's cost centre onto accepted devices (in use or in repair) where it differs.",
  })
  async costCenterSync(_ctx: JobRunContext): Promise<JobSummary> {
    const rows = await this.prisma.asset.findMany({
      where: {
        deletedAt: null,
        status: { in: [...ACTIVE_STATUSES] },
        assignedUserId: { not: null },
        assignments: { some: { ...OPEN_ASSIGNMENT_WHERE, acceptedAt: { not: null } } },
      },
      include: { costCenter: true, model: true, assignedUser: { include: { costCenter: true } } },
    });
    let updated = 0;
    for (const row of rows) {
      const user = row.assignedUser;
      if (!user || user.costCenterId === row.costCenterId) continue;
      await this.prisma.$transaction(async (tx) => {
        const result = await tx.asset.updateMany({
          where: { id: row.id, costCenterId: row.costCenterId, version: row.version },
          data: { costCenterId: user.costCenterId, version: { increment: 1 } },
        });
        if (result.count === 0) return;
        updated++;
        await this.audit.record(
          {
            module: 'assets',
            entityType: 'asset',
            entityId: row.id,
            action: 'cost_center_sync',
            actorId: null,
            actingAs: 'system',
            changes: [
              {
                field: 'costCenter',
                label: 'Cost centre',
                from: costCenterLabel(row.costCenter),
                to: costCenterLabel(user.costCenter),
              },
            ],
            metadata: { userId: user.id },
            entityLabel: assetLabel(row),
          },
          tx,
        );
      });
    }
    return { checked: rows.length, updated };
  }

  /**
   * Weekdays: reminds users of devices still waiting for acceptance - assigned at least
   * ASSET_ACCEPTANCE_REMINDER_DAYS calendar days ago, last reminded at least that long ago, fewer
   * than ASSET_ACCEPTANCE_REMINDER_MAX reminders so far (SPEC §8, SPEC_RESOLUTIONS #23).
   */
  @ScheduledJob({
    name: 'assets.acceptance-reminders',
    slice: 'A3',
    cronEnv: 'CRON_ASSETS_ACCEPTANCE',
    reminder: true,
    description: 'Reminds users to accept devices that have been waiting for acceptance for a few days.',
  })
  async acceptanceReminders(ctx: JobRunContext): Promise<JobSummary> {
    const cadence = this.config.get('ASSET_ACCEPTANCE_REMINDER_DAYS');
    const max = this.config.get('ASSET_ACCEPTANCE_REMINDER_MAX');
    const zone = this.clock.timeZone;
    // Assigned / reminded on or before `today - cadence` (calendar days in APP_TIMEZONE).
    const cutoff = startOfDayInZone(addDaysIso(ctx.today, -cadence + 1), zone);

    const pending = await this.prisma.assetAssignment.findMany({
      where: {
        ...OPEN_ASSIGNMENT_WHERE,
        acceptedAt: null,
        assignedAt: { lt: cutoff },
        asset: { status: 'pending_acceptance', deletedAt: null },
      },
      include: { user: true, asset: { include: { model: { include: { deviceType: true } } } } },
      orderBy: { assignedAt: 'asc' },
    });

    let reminded = 0;
    let skippedMax = 0;
    for (const assignment of pending) {
      if (assignment.reminderCount >= max) {
        skippedMax++;
        continue;
      }
      if (assignment.lastRemindedAt && assignment.lastRemindedAt >= cutoff) continue;
      const reminder = assignment.reminderCount + 1;
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.assetAssignment.updateMany({
          where: { id: assignment.id, reminderCount: assignment.reminderCount },
          data: { reminderCount: reminder, lastRemindedAt: ctx.now },
        });
        if (claimed.count === 0) return;
        reminded++;
        const asset = assignment.asset;
        await this.notifications.send(
          acceptanceReminderNotification,
          {
            to: [{ userId: assignment.userId }],
            context: {
              userName: assignment.user.displayName,
              deviceType: deviceNoun(asset.model.deviceType.name),
              model: asset.model.name,
              assetTag: assetTag(asset.number),
              assignedOn: isoDateInZone(assignment.assignedAt, zone),
              reminder,
              reminderMax: max,
              assetId: asset.id,
            },
            priority: reminder >= HIGH_PRIORITY_REMINDER ? 'high' : 'normal',
            entity: { type: 'asset', id: asset.id },
          },
          { tx },
        );
        await this.audit.record(
          {
            module: 'assets',
            entityType: 'asset',
            entityId: asset.id,
            action: 'remind',
            actorId: null,
            actingAs: 'system',
            metadata: { reminder, userId: assignment.userId },
            entityLabel: assetLabel(asset),
          },
          tx,
        );
      });
    }
    return { reminded, skippedMax };
  }
}
