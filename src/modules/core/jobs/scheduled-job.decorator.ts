import { SetMetadata } from '@nestjs/common';
import type { Env } from '@/config/env.schema';
import type { IsoDate } from '@/common/time/time';

export const SCHEDULED_JOB_METADATA = 'atrium:scheduledJob';

export type JobSlice = 'F' | 'A1' | 'A2' | 'A3' | 'A4';

export interface ScheduledJobOptions {
  /** SPEC §8 job name, e.g. `training.rating-reminders`. Also the pg-boss queue name. */
  name: string;
  description: string;
  slice: JobSlice;
  /**
   * Env variable holding the cron expression (SPEC §8 `CRON_*`), evaluated in APP_TIMEZONE.
   * Omit for manual-only jobs. An empty value disables the schedule.
   */
  cronEnv?: keyof Env;
  /**
   * Reminder job (rating/goal/acceptance reminders): its cron stays off in DEMO_MODE unless
   * ENABLE_REMINDER_CRONS=true, so "Run now" demonstrates it on seeded data (SPEC_RESOLUTIONS #10).
   */
  reminder?: boolean;
  /** Allow `POST /admin/jobs/{name}/run`. Default true (demo.reset: false, SPEC_RESOLUTIONS #29). */
  manual?: boolean;
}

export interface JobRunContext {
  runId: string;
  triggeredBy: 'cron' | 'manual';
  triggeredById: string | null;
  now: Date;
  today: IsoDate;
}

/** A job returns a summary for the JobRun row, e.g. `{ loop1: 3, loop2: 1, skippedMax: 0 }`. */
export type JobSummary = Record<string, number | string>;

/**
 * Declares a scheduled, manually triggerable job (SPEC §8). The method receives a
 * JobRunContext and returns a summary. Core runs it through pg-boss (one run at a time per
 * schedule slot), records a `job_runs` row, and lists it in `GET /admin/jobs`.
 * Audit rows written during the run get the run id as correlation id.
 *
 * @example
 * @ScheduledJob({ name: 'training.rating-reminders', slice: 'A1', cronEnv: 'CRON_TRAINING_RATINGS',
 *                 description: 'Sends due rating reminders' })
 * async ratingReminders(ctx: JobRunContext): Promise<JobSummary> { ...; return { loop1, loop2, loop3, skippedMax }; }
 */
export const ScheduledJob = (options: ScheduledJobOptions): MethodDecorator =>
  SetMetadata(SCHEDULED_JOB_METADATA, options);
