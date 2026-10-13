import { Injectable } from '@nestjs/common';
import { Clock } from '@/common/time/clock.service';
import { AppConfig } from '@/config/app-config';
import { PrismaService } from '@/database/prisma.service';
import { type JobRunContext, type JobSummary, ScheduledJob } from '@/modules/core/jobs/scheduled-job.decorator';
import { NotificationService } from '@/modules/core/notifications/notification.service';
import { formatDateTime } from '../domain/travel-format';
import { highPriorityWhere } from '../domain/travel-rules';
import { travelHighPriorityDigest } from '../mail/travel.high_priority_digest.notification';
import { KIND_LABELS, travelReference } from '../travel.constants';
import { TRAVEL_ENUMS } from '../travel.enums';

/** Travel jobs (SPEC §8). */
@Injectable()
export class TravelJobs {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly clock: Clock,
    private readonly config: AppConfig,
  ) {}

  /** Sends the desk a digest of high-priority requests (pending approval or to book, starting soon). */
  @ScheduledJob({
    name: 'travel.high-priority-digest',
    slice: 'A2',
    cronEnv: 'CRON_TRAVEL_DIGEST',
    description:
      'Emails the travel desk a list of trips that start within the high-priority window and are not booked yet.',
  })
  async highPriorityDigest(ctx: JobRunContext): Promise<JobSummary> {
    const days = this.config.get('TRAVEL_HIGH_PRIORITY_DAYS');
    const rows = await this.prisma.travelRequest.findMany({
      where: highPriorityWhere(ctx.now, days),
      include: { traveller: true },
      orderBy: [{ startsAt: 'asc' }, { number: 'asc' }],
    });
    if (rows.length === 0) return { highPriority: 0, sent: 0 };
    const status = (value: string) => TRAVEL_ENUMS.travelStatus.find((o) => o.value === value)?.label ?? value;
    await this.notifications.send(travelHighPriorityDigest, {
      to: [{ mailbox: 'travel_desk' }],
      context: {
        count: rows.length,
        days,
        items: rows.map((row) => ({
          reference: travelReference(row.number),
          kind: KIND_LABELS[row.kind],
          route: row.routeSummary,
          traveller: row.traveller.displayName,
          when: formatDateTime(row.startsAt, this.clock.timeZone),
          status: status(row.status),
        })),
      },
      priority: 'high',
    });
    return {
      highPriority: rows.length,
      pendingApproval: rows.filter((r) => r.status === 'pending_approval').length,
      toBook: rows.filter((r) => r.status === 'to_book').length,
      sent: 1,
    };
  }
}
