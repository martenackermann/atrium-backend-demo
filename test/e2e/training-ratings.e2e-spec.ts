import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../support/test-app';
import { API, attendeeId, attendeesOf, EMAILS, loginEmail } from './training-helpers';

/** Rating loops 1-3 (SPEC §4.2/§5.1), stats, and the reminder jobs (SPEC §8, SPEC_RESOLUTIONS #10). */
describe('training ratings and reminder jobs', () => {
  let t: TestApp;
  let emma: string;
  let max: string;
  let tina: string;
  let ian: string;
  let arne: string;

  beforeAll(async () => {
    t = await createTestApp({ seed: ['core', 'training'] });
    [emma, max, tina, ian, arne] = await Promise.all(
      (['emma', 'max', 'tina', 'ian', 'arne'] as const).map((p) => t.login(p)),
    );
  });

  afterAll(async () => {
    await t?.close();
  });

  const get = (auth: string, path: string) => t.http().get(`${API}${path}`).set('Authorization', auth);
  const submit = (auth: string, id: string, body: object) =>
    t.http().post(`${API}/training/ratings/${id}/submit`).set('Authorization', auth).send(body);
  const ratingOf = async (number: number, loop: number, index = 0) =>
    t.prisma.trainingRating.findFirstOrThrow({ where: { attendeeId: await attendeeId(t, number, index), loop } });

  /** Triggers a job like the admin UI and waits for its JobRun row. */
  async function runJob(name: string) {
    const res = await t.http().post(`${API}/admin/jobs/${name}/run`).set('Authorization', ian).expect(202);
    for (let i = 0; i < 100; i++) {
      const run = await t.prisma.jobRun.findUniqueOrThrow({ where: { id: res.body.jobRunId } });
      if (run.status !== 'running') return run;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`${name} did not finish`);
  }

  it('lists my due ratings with states and actions', async () => {
    const res = await get(emma, '/training/ratings?state=due,overdue').expect(200);
    const refs = res.body.data.map(
      (r: { training: { reference: string }; loop: number }) => `${r.training.reference}/${r.loop}`,
    );
    expect(refs.sort()).toEqual(['TRN-000003/1', 'TRN-000004/2']);
    expect(res.body.data.every((r: { availableActions: string[] }) => r.availableActions.join() === 'submit')).toBe(
      true,
    );
    const upcoming = await get(emma, '/training/ratings?state=upcoming').expect(200);
    expect(upcoming.body.data.map((r: { training: { reference: string } }) => r.training.reference)).toEqual([
      'TRN-000002',
    ]);
    expect(upcoming.body.data[0].availableActions).toEqual([]);
    await get(emma, '/training/ratings?scope=all').expect(403);
    await get(emma, '/training/ratings?state=late').expect(422);
  });

  it('loop 1: participated -> attended, opens loop 2; validation and guards', async () => {
    const rating = await ratingOf(3, 1);
    const bad = await submit(emma, rating.id, { loop: 1, participated: true, overallGrade: 1 }).expect(422);
    expect(Object.keys(bad.body.errors).sort()).toEqual(['expectationsGrade', 'trainerGrade']);
    await submit(emma, rating.id, { loop: 1, participated: false, overallGrade: 2 }).expect(422);
    await submit(emma, rating.id, {
      loop: 1,
      participated: true,
      overallGrade: 1,
      trainerGrade: 1,
      expectationsGrade: 1,
      appliesLearned: 'A',
    }).expect(422);
    await submit(emma, rating.id, {
      loop: 2,
      appliesLearned: 'A',
      supervisorSupported: 'A',
      worthwhileForOrganization: 'A',
    }).expect(422);
    await submit(max, rating.id, { loop: 1, participated: false }).expect(404);
    await submit(tina, rating.id, { loop: 1, participated: false }).expect(403);

    const res = await submit(emma, rating.id, {
      loop: 1,
      participated: true,
      overallGrade: 2,
      trainerGrade: 1,
      expectationsGrade: 2,
      comment: 'Very practical.',
    }).expect(200);
    expect(res.body).toMatchObject({
      state: 'submitted',
      answers: {
        loop: 1,
        participated: true,
        overallGrade: 2,
        trainerGrade: 1,
        expectationsGrade: 2,
        comment: 'Very practical.',
      },
      availableActions: [],
    });
    const attendee = await t.prisma.trainingAttendee.findUniqueOrThrow({
      where: { id: rating.attendeeId },
      include: { ratings: true },
    });
    expect(attendee.status).toBe('attended');
    expect(attendee.ratings.map((r) => r.loop).sort()).toEqual([1, 2]);
    const audit = await t.prisma.auditLog.findMany({ where: { entityId: attendee.id, action: 'submit_rating_1' } });
    expect(audit).toEqual([expect.objectContaining({ fromState: 'booked', toState: 'attended' })]);
    const again = await submit(emma, rating.id, { loop: 1, participated: false }).expect(409);
    expect(again.body.code).toBe('invalid_transition');
  });

  it('loop 1 not due yet -> 409; did not take part -> not_attended without loop 2', async () => {
    const upcoming = await ratingOf(2, 1);
    await submit(emma, upcoming.id, { loop: 1, participated: false }).expect(409);
    const rating = await ratingOf(24, 1); // ito4, due d-1
    const ito4 = (await attendeesOf(t, 24)).attendees[0];
    const auth = await loginEmail(t, ito4.user.email);
    await submit(auth, rating.id, { loop: 1, participated: false, comment: 'Sick leave' }).expect(200);
    const after = await t.prisma.trainingAttendee.findUniqueOrThrow({
      where: { id: ito4.id },
      include: { ratings: true },
    });
    expect(after.status).toBe('not_attended');
    expect(after.ratings).toHaveLength(1);
  });

  it('loop 2 opens loop 3 for the direct manager; loop 3 answers stay hidden from the attendee', async () => {
    const rating = await ratingOf(4, 2);
    await submit(emma, rating.id, {
      loop: 2,
      appliesLearned: 'A',
      supervisorSupported: 'B',
      worthwhileForOrganization: 'A',
    }).expect(200);
    const loop3 = await ratingOf(4, 3);
    expect(loop3.raterId).toBe(await t.userId('max'));
    expect(loop3.submittedAt).toBeNull();

    const s5 = await ratingOf(5, 3); // Max owes Emma's loop 3
    await get(emma, `/training/ratings/${s5.id}`).expect(404);
    const asMax = await get(max, `/training/ratings/${s5.id}`).expect(200);
    expect(asMax.body).toMatchObject({
      loop: 3,
      state: 'due',
      availableActions: ['submit'],
      attendee: { user: { displayName: 'Emma Employee' } },
    });
    await submit(max, s5.id, { loop: 3, improvementObserved: 5, certificationGained: false }).expect(422);
    const res = await submit(max, s5.id, {
      loop: 3,
      improvementObserved: 1,
      certificationGained: true,
      certificationComment: 'Mediation certificate',
    }).expect(200);
    expect(res.body.answers).toEqual({
      loop: 3,
      improvementObserved: 1,
      certificationGained: true,
      certificationComment: 'Mediation certificate',
      comment: null,
    });
    const asTina = await get(tina, `/training/ratings/${s5.id}`).expect(200);
    expect(asTina.body.answers).not.toBeNull();
    // the attendee sees loop 1-2 rows, and their participation shows the loop-3 brief without answers
    const loop1 = await ratingOf(5, 1);
    const own = await get(emma, `/training/ratings/${loop1.id}`).expect(200);
    expect(own.body.answers).toMatchObject({ loop: 1, participated: true });
    await get(arne, `/training/ratings/${loop1.id}`).expect(404);
  });

  it('office overview: scope=all with filters, and stats', async () => {
    const overdue = await get(tina, '/training/ratings?scope=all&state=overdue').expect(200);
    expect(overdue.body.data).toHaveLength(1);
    expect(overdue.body.data[0]).toMatchObject({ loop: 3, reminderCount: 4, state: 'overdue' });
    const byLoop = await get(tina, '/training/ratings?scope=all&loop=3&sort=-dueAt').expect(200);
    expect(byLoop.body.data.every((r: { loop: number }) => r.loop === 3)).toBe(true);
    const stats = await get(tina, '/training/ratings/stats').expect(200);
    expect(stats.body).toMatchObject({
      from: null,
      to: null,
      open: { overdue: 1, maxedOut: 1 },
      loop3: { distribution: { 1: expect.any(Number) } },
    });
    expect(stats.body.loop1.submitted).toBeGreaterThanOrEqual(9);
    await get(emma, '/training/ratings/stats').expect(403);
    await get(ian, '/training/ratings/stats?from=2026-13-01').expect(422);
  });

  it('rating reminders: cadence, max and summary; idempotent on a second run', async () => {
    const before = await t.prisma.trainingRating.findMany({ where: { submittedAt: null } });
    const run = await runJob('training.rating-reminders');
    expect(run.status).toBe('succeeded');
    const summary = run.summary as Record<string, number>;
    expect(summary.skippedMax).toBe(1);
    expect(summary.loop1 + summary.loop2 + summary.loop3).toBeGreaterThan(0);
    const after = await t.prisma.trainingRating.findMany({ where: { submittedAt: null } });
    const reminded = after.filter((r) => r.reminderCount > (before.find((b) => b.id === r.id)?.reminderCount ?? 0));
    expect(reminded.length).toBe(summary.loop1 + summary.loop2 + summary.loop3);
    for (const r of reminded) {
      const mail = await t.prisma.emailMessage.findFirst({
        where: { entityId: r.id, templateId: 'training.rating_due' },
      });
      expect(mail).not.toBeNull();
    }
    const second = await runJob('training.rating-reminders');
    expect(second.summary).toMatchObject({ loop1: 0, loop2: 0, loop3: 0 });
  });

  it('goals reminders remind booked attendees without goals once', async () => {
    const run = await runJob('training.goals-reminders');
    expect(run.status).toBe('succeeded');
    expect((run.summary as Record<string, number>).reminded).toBeGreaterThanOrEqual(1);
    const s2 = await t.prisma.trainingAttendee.findUniqueOrThrow({ where: { id: await attendeeId(t, 2) } });
    expect(s2.goalsRemindedAt).not.toBeNull();
    const mail = await t.prisma.emailMessage.findFirst({
      where: { entityId: s2.id, templateId: 'training.goals_reminder' },
    });
    expect(mail?.subject).toBe('Set your learning goals for First Aid at Work Refresher');
    const second = await runJob('training.goals-reminders');
    expect(second.summary).toMatchObject({ reminded: 0 });
  });

  it('lists the jobs in the admin job runner', async () => {
    const res = await get(ian, '/admin/jobs').expect(200);
    const names = res.body.map((j: { name: string }) => j.name);
    expect(names).toEqual(expect.arrayContaining(['training.rating-reminders', 'training.goals-reminders']));
    const job = res.body.find((j: { name: string }) => j.name === 'training.rating-reminders');
    expect(job).toMatchObject({ slice: 'A1' });
    void (await loginEmail(t, EMAILS.priya));
  });
});
