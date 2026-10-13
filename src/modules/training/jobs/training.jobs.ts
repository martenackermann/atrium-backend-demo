import { Injectable } from '@nestjs/common';
import { addDaysIso, dateFromIso } from '@/common/time/time';
import { AppConfig } from '@/config/app-config';
import { PrismaService } from '@/database/prisma.service';
import { AuditService } from '@/modules/core/audit/audit.service';
import { type JobRunContext, type JobSummary, ScheduledJob } from '@/modules/core/jobs/scheduled-job.decorator';
import { RATEABLE_ATTENDEE } from '../services/training-ratings.service';
import { TrainingNotifier } from '../services/training-notifier.service';
import { attendeeInclude } from '../services/training.includes';

const DAY_MS = 86_400_000;

/**
 * SPEC §8 reminder jobs. Both are `reminder: true`: in DEMO_MODE their cron stays off unless
 * ENABLE_REMINDER_CRONS=true, and "Run now" (`POST /admin/jobs/{name}/run`) demonstrates them on
 * the seeded due ratings and missing goals (SPEC_RESOLUTIONS #10). Idempotent: cadence and
 * `goalsRemindedAt` guard against duplicates.
 */
@Injectable()
export class TrainingJobs {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: TrainingNotifier,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  @ScheduledJob({
    name: 'training.rating-reminders',
    slice: 'A1',
    cronEnv: 'CRON_TRAINING_RATINGS',
    reminder: true,
    description:
      'Reminds raters of due feedback rounds (loops 1-3), every RATING_REMINDER_CADENCE_DAYS days up to RATING_REMINDER_MAX reminders.',
  })
  async ratingReminders(ctx: JobRunContext): Promise<JobSummary> {
    const max = this.config.get('RATING_REMINDER_MAX');
    const cadenceBefore = new Date(ctx.now.getTime() - this.config.get('RATING_REMINDER_CADENCE_DAYS') * DAY_MS);
    const summary = { loop1: 0, loop2: 0, loop3: 0, skippedMax: 0 };

    summary.skippedMax = await this.prisma.trainingRating.count({
      where: { submittedAt: null, dueAt: { lte: ctx.now }, reminderCount: { gte: max }, ...RATEABLE_ATTENDEE },
    });
    const due = await this.prisma.trainingRating.findMany({
      where: {
        submittedAt: null,
        dueAt: { lte: ctx.now },
        reminderCount: { lt: max },
        AND: [RATEABLE_ATTENDEE, { OR: [{ lastRemindedAt: null }, { lastRemindedAt: { lte: cadenceBefore } }] }],
        rater: { active: true },
      },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
    });

    for (const rating of due) {
      await this.prisma.$transaction(async (tx) => {
        // Re-check inside the transaction (a parallel run may have reminded it already).
        const claimed = await tx.trainingRating.updateMany({
          where: {
            id: rating.id,
            submittedAt: null,
            reminderCount: rating.reminderCount,
          },
          data: { reminderCount: { increment: 1 }, lastRemindedAt: ctx.now },
        });
        if (claimed.count === 0) return;
        const attendee = await tx.trainingAttendee.findUniqueOrThrow({
          where: { id: rating.attendeeId },
          include: attendeeInclude,
        });
        const reminderCount = rating.reminderCount + 1;
        await this.notifier.ratingDue(tx, attendee, { ...rating, reminderCount });
        await this.audit.record(
          {
            module: 'training',
            entityType: 'training_rating',
            entityId: rating.id,
            action: 'remind',
            actorId: null,
            actingAs: 'system',
            metadata: { loop: rating.loop, reminder: reminderCount, max },
            entityLabel: `Feedback round ${rating.loop} · ${attendee.user.displayName}`,
            occurredAt: ctx.now,
          },
          tx,
        );
        summary[`loop${rating.loop}` as 'loop1' | 'loop2' | 'loop3']++;
      });
    }
    return summary;
  }

  @ScheduledJob({
    name: 'training.goals-reminders',
    slice: 'A1',
    cronEnv: 'CRON_TRAINING_GOALS',
    reminder: true,
    description:
      'Reminds booked attendees to set their learning goals GOALS_REMINDER_DAYS_BEFORE days before the start.',
  })
  async goalsReminders(ctx: JobRunContext): Promise<JobSummary> {
    const horizon = addDaysIso(ctx.today, this.config.get('GOALS_REMINDER_DAYS_BEFORE'));
    const rows = await this.prisma.trainingAttendee.findMany({
      where: {
        status: 'booked',
        goal1: null,
        goal2: null,
        goalsRemindedAt: null,
        user: { active: true },
        request: { startsOn: { gt: dateFromIso(ctx.today), lte: dateFromIso(horizon) } },
      },
      include: attendeeInclude,
      orderBy: [{ request: { startsOn: 'asc' } }, { id: 'asc' }],
    });
    let reminded = 0;
    for (const row of rows) {
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.trainingAttendee.updateMany({
          where: { id: row.id, goalsRemindedAt: null },
          data: { goalsRemindedAt: ctx.now },
        });
        if (claimed.count === 0) return;
        await this.notifier.goalsReminder(tx, row);
        await this.audit.record(
          {
            module: 'training',
            entityType: 'training_attendee',
            entityId: row.id,
            action: 'remind',
            actorId: null,
            actingAs: 'system',
            metadata: { kind: 'goals' },
            entityLabel: row.user.displayName,
            occurredAt: ctx.now,
          },
          tx,
        );
        reminded++;
      });
    }
    return { reminded };
  }
}
