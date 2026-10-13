import { SetMetadata } from '@nestjs/common';
import type { JobWithMetadata, QueueOptions } from 'pg-boss';

export const JOB_HANDLER_METADATA = 'atrium:jobHandler';

export interface JobHandlerOptions {
  /** Queue defaults (retryLimit, retryDelay, expireInSeconds...) applied when the queue is created. */
  queue?: QueueOptions;
  /** Base polling interval in seconds (>= 0.5). Default 2. */
  pollingIntervalSeconds?: number;
  /** Parallel workers for this queue in this process. Default 1. */
  localConcurrency?: number;
}

export interface JobHandlerMetadata {
  name: string;
  options: JobHandlerOptions;
}

/**
 * Signature of a method decorated with `@JobHandler()`. Throw to fail (and retry) the job;
 * `job.retryCount` / `job.retryLimit` tell whether this is the last attempt.
 */
export type JobHandlerFn<T = unknown> = (data: T, job: JobWithMetadata<T>) => Promise<unknown>;

/**
 * Registers a provider method as the worker for a pg-boss queue. The provider must be
 * listed in its module's `providers`; QueueService discovers it at bootstrap.
 * Queue names are `<module>.<job>` in kebab-case, e.g. `training.send-reminder`.
 *
 * @example
 * @JobHandler('training.send-reminder', { queue: { retryLimit: 3 } })
 * async sendReminder(data: ReminderJob) { ... }
 */
export const JobHandler = (name: string, options: JobHandlerOptions = {}): MethodDecorator =>
  SetMetadata<string, JobHandlerMetadata>(JOB_HANDLER_METADATA, { name, options });
