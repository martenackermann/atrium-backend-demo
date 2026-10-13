import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '@/config/app-config';
import { PrismaService } from '@/database/prisma.service';
import { runSeed } from '@/database/seed/run-seed';
import { truncateAll } from '@/database/truncate';
import { StorageService } from '@/infra/storage/storage.service';
import { type JobRunContext, ScheduledJob, type JobSummary } from './scheduled-job.decorator';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Foundation jobs (SPEC §8): `core.purge` and `demo.reset`. */
@Injectable()
export class CoreJobs {
  private readonly logger = new Logger(CoreJobs.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: AppConfig,
  ) {}

  @ScheduledJob({
    name: 'core.purge',
    slice: 'F',
    cronEnv: 'CRON_CORE_PURGE',
    description:
      'Deletes staged uploads older than 24 h, binaries of attachments deleted 30+ days ago, idempotency keys older than 24 h and expired sessions.',
  })
  async purge(ctx: JobRunContext): Promise<JobSummary> {
    const now = ctx.now.getTime();
    const staged = await this.prisma.attachment.findMany({
      where: { entityId: null, createdAt: { lt: new Date(now - DAY) } },
      select: { id: true, storageKey: true },
    });
    for (const row of staged) await this.storage.delete(row.storageKey);
    await this.prisma.attachment.deleteMany({ where: { id: { in: staged.map((r) => r.id) } } });

    const deleted = await this.prisma.attachment.findMany({
      where: { deletedAt: { lt: new Date(now - 30 * DAY) } },
      select: { id: true, storageKey: true },
    });
    for (const row of deleted) await this.storage.delete(row.storageKey);

    const keys = await this.prisma.idempotencyKey.deleteMany({ where: { createdAt: { lt: new Date(now - DAY) } } });
    const sessions = await this.prisma.authSession.deleteMany({ where: { expiresAt: { lt: new Date(now - DAY) } } });
    return {
      stagedAttachments: staged.length,
      deletedBinaries: deleted.length,
      idempotencyKeys: keys.count,
      sessions: sessions.count,
    };
  }

  @ScheduledJob({
    name: 'demo.reset',
    slice: 'F',
    cronEnv: 'DEMO_RESET_CRON',
    manual: false,
    description:
      'Truncates all tables and re-runs the seed relative to the new "today" (disabled unless DEMO_RESET_CRON is set).',
  })
  async demoReset(): Promise<JobSummary> {
    if (!this.config.get('DEMO_MODE')) return { skipped: 'DEMO_MODE is off' };
    const tables = await truncateAll(this.prisma, { jobs: false });
    await runSeed(this.prisma, { env: this.config.snapshot(), log: (m) => this.logger.log(m) });
    return { tables };
  }
}
