import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { CronJob } from 'cron';
import { toUserRefOrNull } from '@/common/domain/mappers';
import { ProblemException } from '@/common/http/problem';
import { RequestContext } from '@/common/http/request-context';
import { Clock } from '@/common/time/clock.service';
import { AppConfig } from '@/config/app-config';
import { PrismaService } from '@/database/prisma.service';
import type { Prisma } from '@/generated/prisma/client';
import { QueueService } from '@/infra/queue/queue.service';
import {
  type JobRunContext,
  type JobSummary,
  SCHEDULED_JOB_METADATA,
  type ScheduledJobOptions,
} from './scheduled-job.decorator';

interface RegisteredJob {
  options: ScheduledJobOptions;
  handler: (ctx: JobRunContext) => Promise<JobSummary>;
  cron: string | null;
  cronJob: CronJob | null;
}

interface JobPayload {
  trigger: 'cron' | 'manual';
  jobRunId?: string;
}

type JobRunRow = Prisma.JobRunGetPayload<{ include: { triggeredByUser: true } }>;

export function toJobRunDto(row: JobRunRow) {
  return {
    id: row.id,
    jobName: row.jobName,
    triggeredBy: row.triggeredBy,
    triggeredByUser: toUserRefOrNull(row.triggeredByUser),
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    status: row.status,
    summary: row.summary as Record<string, number | string>,
    error: row.error,
  };
}

/**
 * Runs `@ScheduledJob()` methods (SPEC §8): cron triggers (APP_TIMEZONE) enqueue a pg-boss
 * job with a per-slot singleton key, it_admin can trigger manually, and every run writes a
 * `job_runs` row with its summary. Crons are not started when NODE_ENV=test.
 */
@Injectable()
export class JobRegistry implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(JobRegistry.name);
  private readonly jobs = new Map<string, RegisteredJob>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly queue: QueueService,
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly clock: Clock,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const wrapper of this.discovery.getProviders()) {
      const instance: unknown = wrapper.instance;
      if (!instance || typeof instance !== 'object' || wrapper.isNotMetatype) continue;
      for (const methodName of this.scanner.getAllMethodNames(Object.getPrototypeOf(instance) as object)) {
        const method = (instance as Record<string, unknown>)[methodName];
        if (typeof method !== 'function') continue;
        const options = this.reflector.get<ScheduledJobOptions | undefined>(SCHEDULED_JOB_METADATA, method);
        if (options) await this.register(options, (method as RegisteredJob['handler']).bind(instance));
      }
    }
  }

  onApplicationShutdown(): void {
    for (const job of this.jobs.values()) void job.cronJob?.stop();
  }

  list() {
    return [...this.jobs.values()].sort((a, b) => a.options.name.localeCompare(b.options.name));
  }

  async describeAll() {
    const lastRuns = await this.prisma.jobRun.findMany({
      where: { jobName: { in: [...this.jobs.keys()] } },
      orderBy: { startedAt: 'desc' },
      distinct: ['jobName'],
      include: { triggeredByUser: true },
    });
    return this.list().map((job) => ({
      name: job.options.name,
      description: job.options.description,
      slice: job.options.slice,
      cron: job.cron,
      enabled: job.cron !== null,
      nextRunAt: job.cronJob ? (job.cronJob.nextDate().toJSDate().toISOString() ?? null) : null,
      lastRun: (() => {
        const run = lastRuns.find((r) => r.jobName === job.options.name);
        return run ? toJobRunDto(run) : null;
      })(),
    }));
  }

  require(name: string): RegisteredJob {
    const job = this.jobs.get(name);
    if (!job) throw ProblemException.notFound('Job');
    return job;
  }

  /** Manual trigger (`POST /admin/jobs/{name}/run`): creates the JobRun row and enqueues the run. */
  async trigger(name: string, userId: string | null): Promise<string> {
    const job = this.require(name);
    if (job.options.manual === false) throw ProblemException.forbidden('This job cannot be run manually.');
    const run = await this.prisma.jobRun.create({
      data: { jobName: name, triggeredBy: 'manual', triggeredById: userId, status: 'running' },
    });
    await this.queue.send<JobPayload>(name, { trigger: 'manual', jobRunId: run.id });
    return run.id;
  }

  private async register(options: ScheduledJobOptions, handler: RegisteredJob['handler']): Promise<void> {
    if (this.jobs.has(options.name)) throw new Error(`Duplicate @ScheduledJob "${options.name}"`);
    const rawCron = options.cronEnv ? this.config.get(options.cronEnv) : undefined;
    const suppressed = options.reminder && this.config.get('DEMO_MODE') && !this.config.get('ENABLE_REMINDER_CRONS');
    const cron = typeof rawCron === 'string' && rawCron.trim() && !suppressed ? rawCron.trim() : null;
    const job: RegisteredJob = { options, handler, cron, cronJob: null };
    if (cron) {
      job.cronJob = new CronJob(
        cron,
        () => void this.enqueueCron(options.name),
        null,
        !this.config.isTest,
        this.config.get('APP_TIMEZONE'),
      );
    }
    this.jobs.set(options.name, job);
    await this.queue.work({ name: options.name, options: { queue: { retryLimit: 0 } } }, (data) =>
      this.execute(job, data as JobPayload),
    );
  }

  /**
   * Cron tick: claims the scheduled slot in `job_runs` (unique job_name + slot), so several
   * API instances or restarts never run the same slot twice (SPEC_RESOLUTIONS #10).
   */
  private async enqueueCron(name: string): Promise<void> {
    const slot = this.clock.now().toISOString().slice(0, 16); // per-minute slot
    try {
      const claimed = await this.prisma.jobRun.createMany({
        data: [{ jobName: name, triggeredBy: 'cron', status: 'running', slot }],
        skipDuplicates: true,
      });
      if (claimed.count === 0) return;
      const run = await this.prisma.jobRun.findUniqueOrThrow({ where: { jobName_slot: { jobName: name, slot } } });
      await this.queue.send<JobPayload>(
        name,
        { trigger: 'cron', jobRunId: run.id },
        { singletonKey: `${name}:${slot}` },
      );
    } catch (error) {
      this.logger.error(error, `Could not enqueue ${name}`);
    }
  }

  private async execute(job: RegisteredJob, data: JobPayload): Promise<void> {
    const name = job.options.name;
    const existing = data.jobRunId ? await this.prisma.jobRun.findUnique({ where: { id: data.jobRunId } }) : null;
    const run =
      existing ??
      (await this.prisma.jobRun.create({
        data: { id: data.jobRunId, jobName: name, triggeredBy: data.trigger, status: 'running' },
      }));
    const ctx: JobRunContext = {
      runId: run.id,
      triggeredBy: run.triggeredBy,
      triggeredById: run.triggeredById,
      now: this.clock.now(),
      today: this.clock.today(),
    };
    let result: { status: 'succeeded' | 'failed'; summary: JobSummary; error: string | null };
    try {
      const summary = await RequestContext.run(run.id, () => job.handler(ctx));
      result = { status: 'succeeded', summary: summary ?? {}, error: null };
    } catch (error) {
      this.logger.error(error, `Job ${name} failed`);
      result = { status: 'failed', summary: {}, error: error instanceof Error ? error.message : String(error) };
    }
    // upsert: demo.reset truncates job_runs while it runs
    await this.prisma.jobRun.upsert({
      where: { id: run.id },
      update: { ...result, finishedAt: new Date() },
      create: {
        id: run.id,
        jobName: name,
        triggeredBy: run.triggeredBy,
        startedAt: run.startedAt,
        ...result,
        finishedAt: new Date(),
      },
    });
  }
}
