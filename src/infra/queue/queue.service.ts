import { BeforeApplicationShutdown, Injectable, Logger, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { fromPrisma, type JobSpyInterface, PgBoss, type QueueOptions, type SendOptions } from 'pg-boss';
import { AppConfig } from '@/config/app-config';
import { PG_BOSS_SCHEMA } from './queue.constants';
import type { PrismaTx } from '@/database/prisma.types';
import { JOB_HANDLER_METADATA, type JobHandlerFn, type JobHandlerMetadata } from './job-handler.decorator';

export { PG_BOSS_SCHEMA };

export interface SendJobOptions extends Omit<SendOptions, 'db'> {
  /**
   * Enqueue inside a Prisma interactive transaction: the job only exists if the
   * transaction commits.
   */
  tx?: PrismaTx;
}

/**
 * pg-boss wrapper. Starts with the app, discovers `@JobHandler()` methods and stops
 * gracefully on shutdown. Use `send()` to enqueue work.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(QueueService.name);
  private readonly boss: PgBoss;
  private readonly knownQueues = new Set<string>();
  private readonly handlerNames = new Set<string>();
  private started: Promise<void> | undefined;
  private stopped = false;

  constructor(
    private readonly config: AppConfig,
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {
    this.boss = new PgBoss({
      connectionString: config.get('DATABASE_URL'),
      schema: PG_BOSS_SCHEMA,
      application_name: 'atrium-api',
      max: 5,
      __test__enableSpies: config.isTest,
    });
    this.boss.on('error', (error: unknown) => this.logger.error(error, 'pg-boss error'));
  }

  async onModuleInit(): Promise<void> {
    this.started = this.boss.start({ attempts: 3 }).then(() => undefined);
    await this.started;
  }

  async onApplicationBootstrap(): Promise<void> {
    for (const wrapper of this.discovery.getProviders()) {
      const instance: unknown = wrapper.instance;
      if (!instance || typeof instance !== 'object' || wrapper.isNotMetatype) continue;
      const prototype = Object.getPrototypeOf(instance) as object;
      for (const methodName of this.scanner.getAllMethodNames(prototype)) {
        const method = (instance as Record<string, unknown>)[methodName];
        if (typeof method !== 'function') continue;
        const meta = this.reflector.get<JobHandlerMetadata | undefined>(JOB_HANDLER_METADATA, method);
        if (meta) await this.registerWorker(meta, (method as JobHandlerFn).bind(instance));
      }
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    if (this.stopped || !this.started) return;
    this.stopped = true;
    await this.boss.stop({ graceful: true, timeout: 10_000 });
  }

  /** Enqueue a job. Returns the job id (null when deduplicated by singleton options). */
  async send<T extends object>(name: string, data: T, options: SendJobOptions = {}): Promise<string | null> {
    await this.ensureQueue(name);
    const { tx, ...rest } = options;
    return this.boss.send(name, data, { ...rest, ...(tx ? { db: fromPrisma(tx) } : {}) });
  }

  /** Creates the queue if this process has not seen it yet (pg-boss requires explicit queues). */
  async ensureQueue(name: string, options?: QueueOptions): Promise<void> {
    if (this.knownQueues.has(name)) return;
    await this.started;
    if (!(await this.boss.getQueue(name))) await this.boss.createQueue(name, options);
    this.knownQueues.add(name);
  }

  /** Liveness of the queue backend for the health endpoint. */
  async isHealthy(): Promise<boolean> {
    if (!this.started || this.stopped) return false;
    try {
      await this.started;
      return await this.boss.isInstalled();
    } catch {
      return false;
    }
  }

  /** Test-only job spy (NODE_ENV=test): `await queue.spy('mail.send').waitForJob(() => true, 'completed')`. */
  spy<T extends object = object>(name: string): JobSpyInterface<T> {
    return this.boss.getSpy<T>(name);
  }

  /** Names of queues with a registered worker in this process. */
  get workerNames(): string[] {
    return [...this.handlerNames];
  }

  private async registerWorker(meta: JobHandlerMetadata, handler: JobHandlerFn): Promise<void> {
    if (this.handlerNames.has(meta.name)) {
      throw new Error(`Duplicate @JobHandler for queue "${meta.name}"`);
    }
    this.handlerNames.add(meta.name);
    await this.ensureQueue(meta.name, meta.options.queue);
    await this.boss.work<unknown>(
      meta.name,
      {
        batchSize: 1,
        pollingIntervalSeconds: meta.options.pollingIntervalSeconds ?? (this.config.isTest ? 0.5 : 2),
        localConcurrency: meta.options.localConcurrency ?? 1,
      },
      async ([job]) => {
        if (!job) return;
        await handler(job.data, job);
      },
    );
    this.logger.log(`Worker registered for queue "${meta.name}"`);
  }
}
