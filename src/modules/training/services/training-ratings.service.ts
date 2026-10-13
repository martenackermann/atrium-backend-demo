import { Injectable } from '@nestjs/common';
import { transition } from 'xstate';
import type { AuthUser } from '@/common/auth/auth-user';
import type { AppAbility } from '@/common/authz/ability.types';
import { paginate } from '@/common/http/pagination';
import { ProblemException } from '@/common/http/problem';
import { toPrismaOrderBy } from '@/common/http/sort';
import { Clock } from '@/common/time/clock.service';
import { addDaysIso, dateFromIso, isoDateInZone, isoFromDate, startOfDayInZone } from '@/common/time/time';
import { AppConfig } from '@/config/app-config';
import { PrismaService } from '@/database/prisma.service';
import type { PrismaTx } from '@/database/prisma.types';
import type { Prisma } from '@/generated/prisma/client';
import { AuditService } from '@/modules/core/audit/audit.service';
import type { ListRatingsQuery, RatingSubmission } from '../dto/training-request.dto';
import type { RatingStatsView, TrainingRatingView } from '../dto/training-response.schemas';
import { trainingAttendeeMachine } from '../machines/training-attendee.machine';
import { parseTrainingReference, type RatingState } from '../training.constants';
import { TrainingAccess, type TrainingViewer } from './training-access.service';
import { TrainingMapper } from './training-mapper.service';
import { ratingInclude } from './training.includes';

const DAY_MS = 86_400_000;

/** Prisma filter for one derived rating state at `now` (SPEC §4.2). */
export function ratingStateWhere(state: RatingState, now: Date, overdueDays: number): Prisma.TrainingRatingWhereInput {
  const overdueBefore = new Date(now.getTime() - overdueDays * DAY_MS);
  switch (state) {
    case 'submitted':
      return { submittedAt: { not: null } };
    case 'upcoming':
      return { submittedAt: null, dueAt: { gt: now } };
    case 'due':
      return { submittedAt: null, dueAt: { lte: now, gte: overdueBefore } };
    case 'overdue':
      return { submittedAt: null, dueAt: { lt: overdueBefore } };
  }
}

/** Unsubmitted rows whose attendee is in the state the loop needs (loop 1: booked; 2-3: attended). */
export const RATEABLE_ATTENDEE: Prisma.TrainingRatingWhereInput = {
  OR: [
    { loop: 1, attendee: { status: 'booked' } },
    { loop: { in: [2, 3] }, attendee: { status: 'attended' } },
  ],
};

/** `/training/ratings*` (API.md §4.1): lists, submission (loops 1-3) and the office stats. */
@Injectable()
export class TrainingRatingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TrainingAccess,
    private readonly mapper: TrainingMapper,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
    private readonly clock: Clock,
  ) {}

  private get overdueDays(): number {
    return this.config.get('RATING_OVERDUE_DAYS');
  }

  async list(user: AuthUser, ability: AppAbility, query: ListRatingsQuery) {
    const viewer = await this.access.viewer(user, ability);
    if (query.scope === 'all' && !viewer.isBackOffice)
      throw ProblemException.forbidden('Only the training office can list all ratings.');
    const now = this.clock.now();
    const and: Prisma.TrainingRatingWhereInput[] = [query.scope === 'all' ? {} : { raterId: user.id }];
    if (query.state) and.push({ OR: query.state.map((s) => ratingStateWhere(s, now, this.overdueDays)) });
    if (query.loop) and.push({ loop: { in: query.loop.map(Number) } });
    if (query.q) {
      const num = parseTrainingReference(query.q);
      and.push(
        num !== null
          ? { attendee: { request: { number: num } } }
          : {
              OR: [
                { attendee: { request: { topic: { contains: query.q, mode: 'insensitive' } } } },
                { attendee: { request: { provider: { contains: query.q, mode: 'insensitive' } } } },
                { attendee: { user: { displayName: { contains: query.q, mode: 'insensitive' } } } },
              ],
            },
      );
    }
    const where: Prisma.TrainingRatingWhereInput = { AND: and };
    const orderBy = [
      ...(toPrismaOrderBy(query.sort) as Prisma.TrainingRatingOrderByWithRelationInput[]),
      { id: 'asc' as const },
    ];
    return paginate<TrainingRatingView>(
      query,
      async (page) =>
        (await this.prisma.trainingRating.findMany({ where, orderBy, include: ratingInclude, ...page })).map((r) =>
          this.mapper.rating(r, viewer),
        ),
      () => this.prisma.trainingRating.count({ where }),
    );
  }

  private async findVisible(id: string, viewer: TrainingViewer, db: PrismaTx = this.prisma) {
    const row = await db.trainingRating.findFirst({ where: { id, ...viewer.ratingWhere() }, include: ratingInclude });
    if (!row) throw ProblemException.notFound('Rating');
    return row;
  }

  async get(id: string, user: AuthUser, ability: AppAbility): Promise<TrainingRatingView> {
    const viewer = await this.access.viewer(user, ability);
    return this.mapper.rating(await this.findVisible(id, viewer), viewer);
  }

  async submit(id: string, user: AuthUser, ability: AppAbility, body: RatingSubmission): Promise<TrainingRatingView> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM training_ratings WHERE id = ${id}::uuid FOR UPDATE`;
      const viewer = await this.access.viewer(user, undefined, tx);
      const row = await this.findVisible(id, viewer, tx);
      if (row.raterId !== user.id) throw ProblemException.forbidden('Only the rater can submit this feedback.');
      if (row.submittedAt) throw ProblemException.conflict('This feedback was already submitted.', 'invalid_transition');
      const now = this.clock.now();
      if (row.dueAt.getTime() > now.getTime())
        throw ProblemException.conflict('This feedback round is not due yet.', 'invalid_transition');
      if (body.loop !== row.loop) throw ProblemException.fieldError('loop', `This is feedback round ${row.loop}.`);
      const attendee = row.attendee;
      const needed = row.loop === 1 ? 'booked' : 'attended';
      if (attendee.status !== needed)
        throw ProblemException.conflict(
          `Feedback round ${row.loop} needs the participation to be ${needed}.`,
          'invalid_transition',
        );

      await tx.trainingRating.update({ where: { id }, data: { ...this.answerData(body), submittedAt: now } });
      await this.audit.record(
        {
          module: 'training',
          entityType: 'training_rating',
          entityId: id,
          action: 'submit',
          actorId: user.id,
          actingAs: 'self',
          metadata: { loop: row.loop, attendeeId: attendee.id },
          entityLabel: `Feedback round ${row.loop} · ${attendee.user.displayName}`,
        },
        tx,
      );

      if (body.loop === 1) {
        // booked -> attended / not_attended (machine event submit_rating_1).
        const snapshot = trainingAttendeeMachine.resolveState({
          value: 'booked',
          context: {
            attendeeId: attendee.userId,
            requesterId: attendee.request.requesterId,
            executiveApproverId: attendee.executiveApproverId,
            startsOn: isoFromDate(attendee.request.startsOn),
            endsOn: isoFromDate(attendee.request.endsOn),
            today: this.clock.today(),
            statusBeforeCancellation: null,
          },
        });
        const [next] = transition(trainingAttendeeMachine, snapshot, {
          type: 'submit_rating_1',
          actor: user,
          input: { participated: body.participated === true },
        });
        const toState = String(next.value) as 'attended' | 'not_attended';
        await tx.trainingAttendee.update({ where: { id: attendee.id }, data: { status: toState, version: { increment: 1 } } });
        await this.audit.record(
          {
            module: 'training',
            entityType: 'training_attendee',
            entityId: attendee.id,
            action: 'submit_rating_1',
            actorId: user.id,
            actingAs: 'self',
            fromState: 'booked',
            toState,
            entityLabel: attendee.user.displayName,
          },
          tx,
        );
        if (body.participated === true) await this.openNextLoop(tx, attendee.id, 2, attendee.userId, now);
      } else if (body.loop === 2) {
        // Loop 3: rated by the attendee's direct manager (skipped without an active manager).
        const manager = viewer.org.manager(viewer.org.require(attendee.userId));
        if (manager?.active) await this.openNextLoop(tx, attendee.id, 3, manager.id, now);
      }
    });
    return this.get(id, user, ability);
  }

  private async openNextLoop(tx: PrismaTx, attendeeId: string, loop: 2 | 3, raterId: string, submittedAt: Date) {
    const delay = this.config.get(loop === 2 ? 'RATING_LOOP2_DELAY_DAYS' : 'RATING_LOOP3_DELAY_DAYS');
    const dueOn = addDaysIso(isoDateInZone(submittedAt, this.clock.timeZone), delay);
    const rating = await tx.trainingRating.upsert({
      where: { attendeeId_loop: { attendeeId, loop } },
      create: { attendeeId, loop, raterId, dueAt: startOfDayInZone(dueOn, this.clock.timeZone) },
      update: {},
    });
    await this.audit.record(
      {
        module: 'training',
        entityType: 'training_rating',
        entityId: rating.id,
        action: 'create',
        actorId: null,
        actingAs: 'system',
        metadata: { loop, dueOn },
        entityLabel: `Feedback round ${loop}`,
      },
      tx,
    );
  }

  private answerData(body: RatingSubmission): Prisma.TrainingRatingUpdateInput {
    switch (body.loop) {
      case 1:
        return {
          participated: body.participated ?? false,
          overallGrade: body.participated ? (body.overallGrade ?? null) : null,
          trainerGrade: body.participated ? (body.trainerGrade ?? null) : null,
          expectationsGrade: body.participated ? (body.expectationsGrade ?? null) : null,
          comment: body.comment ?? null,
        };
      case 2:
        return {
          appliesLearned: body.appliesLearned ?? null,
          supervisorSupported: body.supervisorSupported ?? null,
          worthwhileForOrganization: body.worthwhileForOrganization ?? null,
          comment: body.comment ?? null,
        };
      case 3:
        return {
          improvementObserved: body.improvementObserved ?? null,
          certificationGained: body.certificationGained ?? null,
          certificationComment: body.certificationComment ?? null,
          comment: body.comment ?? null,
        };
    }
  }

  async stats(user: AuthUser, ability: AppAbility, from?: string, to?: string): Promise<RatingStatsView> {
    const viewer = await this.access.viewer(user, ability);
    if (!viewer.isBackOffice) throw ProblemException.forbidden('Only the training office can see the rating statistics.');
    const endsOn: Prisma.DateTimeFilter = {};
    if (from) endsOn.gte = dateFromIso(from);
    if (to) endsOn.lte = dateFromIso(to);
    const rows = await this.prisma.trainingRating.findMany({
      where: from || to ? { attendee: { request: { endsOn } } } : {},
    });
    const now = this.clock.now();
    const max = this.config.get('RATING_REMINDER_MAX');
    const submitted = (loop: number) => rows.filter((r) => r.loop === loop && r.submittedAt);
    const avg = (values: (number | null)[]) => {
      const nums = values.filter((v): v is number => v !== null);
      return nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : null;
    };
    const l1 = submitted(1);
    const participated = l1.filter((r) => r.participated);
    const l2 = submitted(2);
    const likert = (field: 'appliesLearned' | 'supervisorSupported' | 'worthwhileForOrganization') => {
      const dist = { A: 0, B: 0, C: 0, D: 0 };
      for (const r of l2) if (r[field]) dist[r[field]]++;
      return dist;
    };
    const l3 = submitted(3);
    const improvement = { 1: 0, 2: 0, 3: 0, 4: 0 } as Record<1 | 2 | 3 | 4, number>;
    for (const r of l3) if (r.improvementObserved) improvement[r.improvementObserved as 1 | 2 | 3 | 4]++;
    const open = rows.filter((r) => !r.submittedAt);
    const overdueBefore = now.getTime() - this.overdueDays * DAY_MS;
    return {
      from: from ?? null,
      to: to ?? null,
      loop1: {
        submitted: l1.length,
        participatedRate: l1.length ? Math.round((participated.length / l1.length) * 1000) / 1000 : 0,
        avgOverall: avg(participated.map((r) => r.overallGrade)),
        avgTrainer: avg(participated.map((r) => r.trainerGrade)),
        avgExpectations: avg(participated.map((r) => r.expectationsGrade)),
      },
      loop2: {
        submitted: l2.length,
        distribution: {
          appliesLearned: likert('appliesLearned'),
          supervisorSupported: likert('supervisorSupported'),
          worthwhileForOrganization: likert('worthwhileForOrganization'),
        },
      },
      loop3: {
        submitted: l3.length,
        distribution: improvement,
        certificationRate: l3.length
          ? Math.round((l3.filter((r) => r.certificationGained).length / l3.length) * 1000) / 1000
          : null,
      },
      open: {
        due: open.filter((r) => r.dueAt.getTime() <= now.getTime() && r.dueAt.getTime() >= overdueBefore).length,
        overdue: open.filter((r) => r.dueAt.getTime() < overdueBefore).length,
        maxedOut: open.filter((r) => r.reminderCount >= max).length,
      },
    };
  }
}
