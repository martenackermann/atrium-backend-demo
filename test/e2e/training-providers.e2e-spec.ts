import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InboxService } from '@/modules/core/inbox/inbox.service';
import { createTestApp, type TestApp } from '../support/test-app';
import { API, attendeeId, EMAILS, loginEmail } from './training-helpers';

/** Inbox / search / my-day providers, queue counts, meta registrations and the attachment policy. */
describe('training providers and counts', () => {
  let t: TestApp;
  let auth: Record<string, string>;

  beforeAll(async () => {
    t = await createTestApp({ seed: ['core', 'training'] });
    auth = Object.fromEntries(
      await Promise.all(
        (['emma', 'max', 'sofia', 'clara', 'tina', 'ian', 'arne'] as const).map(
          async (p) => [p, await t.login(p)] as const,
        ),
      ),
    );
    auth.helen = await loginEmail(t, EMAILS.helen);
  });

  afterAll(async () => {
    await t?.close();
  });

  const get = (who: string, path: string) => t.http().get(`${API}${path}`).set('Authorization', auth[who]);
  type Item = {
    type: string;
    title: string;
    subtitle: string;
    actingAs: string;
    link: string;
    quickActions: string[];
    actionsPath: string | null;
    priority: string;
    dueAt: string | null;
  };
  const inbox = async (who: string): Promise<Item[]> =>
    (await get(who, '/me/inbox?module=training').expect(200)).body.data;

  it("Emma's inbox: due ratings and missing goals", async () => {
    const items = await inbox('emma');
    expect(items.map((i) => i.type).sort()).toEqual([
      'training.goals_missing',
      'training.rating_due',
      'training.rating_due',
    ]);
    const goals = items.find((i) => i.type === 'training.goals_missing')!;
    expect(goals).toMatchObject({
      title: 'Set goals: First Aid at Work Refresher',
      actionsPath: null,
      quickActions: [],
    });
    expect(goals.link).toMatch(/^\/training\/participations\/[0-9a-f-]+#goals$/);
    expect(goals.dueAt).toMatch(/T2[23]:00:00\.000Z$/); // 00:00 Europe/Berlin as UTC
  });

  it("Max's inbox: own approvals, deputy approvals for Priya and the loop-3 rating", async () => {
    const items = await inbox('max');
    const approvals = items.filter((i) => i.type === 'training.approval_required');
    expect(approvals).toHaveLength(5);
    const deputy = approvals.filter((i) => i.actingAs === 'deputy');
    expect(deputy).toHaveLength(2);
    expect(deputy[0].subtitle).toContain('for Priya Raman');
    expect(deputy[0].link).toContain('tab=deputy');
    expect(approvals[0]).toMatchObject({ quickActions: ['approve', 'decline'] });
    expect(approvals[0].actionsPath).toMatch(/^\/training\/participations\//);
    // the team (chain override) item is not in the inbox
    expect(approvals.some((i) => i.title.includes('Eastgate'))).toBe(false);
    const rating = items.find((i) => i.type === 'training.rating_due')!;
    expect(rating.title).toBe("Rate Emma Employee's progress: Conflict Resolution for Field Teams");
  });

  it("Clara's inbox: executive steps; Helen sees them as deputy", async () => {
    const items = await inbox('clara');
    const exec = items.filter((i) => i.actingAs === 'executive');
    expect(exec).toHaveLength(3);
    expect(exec.every((i) => i.subtitle.endsWith('executive step') && i.link.includes('tab=executive'))).toBe(true);
    const helen = await inbox('helen');
    expect(helen.filter((i) => i.actingAs === 'deputy')).toHaveLength(4);
  });

  it('training office queue items for training_office only (not it_admin)', async () => {
    const tina = await inbox('tina');
    expect(tina.filter((i) => i.type === 'training.booking_required')).toHaveLength(5);
    expect(tina.filter((i) => i.type === 'training.cancellation_review')).toHaveLength(2);
    const high = tina.find((i) => i.priority === 'high')!;
    expect(high.title).toBe('Book: ITIL Foundation');
    expect(await inbox('ian')).toEqual([]);
  });

  it('excludes my own participation from my approval inbox (#13)', async () => {
    const res = await t
      .http()
      .post(`${API}/training/requests`)
      .set('Authorization', auth.helen)
      .send({
        topic: 'Treasury Basics',
        provider: 'Summit Skills',
        format: 'online',
        startsOn: '2099-01-10',
        endsOn: '2099-01-10',
        cost: { amountCents: 10000, currency: 'EUR' },
        certificateExpected: false,
        reimbursementAgreement: false,
        attendees: [{ userId: await t.userId(EMAILS.helen) }],
      })
      .expect(201);
    expect(res.body.attendees[0].status).toBe('to_book');
    const items = await inbox('helen');
    expect(items.some((i) => i.title.includes('Helen Brooks'))).toBe(false);
  });

  it('queue counts per persona', async () => {
    const max = (await get('max', '/training/queues/counts').expect(200)).body;
    expect(max).toEqual({
      mine: { active: 1, ratingsDue: 1, goalsMissing: 0 },
      approvals: { manager: 3, executive: 0, deputy: 2, team: 1 },
      office: null,
    });
    const emma = (await get('emma', '/training/queues/counts').expect(200)).body;
    expect(emma.mine).toEqual({ active: 3, ratingsDue: 2, goalsMissing: 1 });
    const tina = (await get('tina', '/training/queues/counts').expect(200)).body;
    expect(tina.office).toEqual({
      toBook: 6, // 5 seeded + Helen's auto-approved request from the #13 test

      cancellationRequested: 2,
      pendingApproval: 10,
      bookingImpossible: 1,
      ratingsOverdue: 1,
      billingOpen: 6,
    });
    const clara = (await get('clara', '/training/queues/counts').expect(200)).body;
    expect(clara.approvals).toMatchObject({ manager: 1, executive: 3 });
  });

  it('search: references, topics and approvals by attendee name, permission-filtered', async () => {
    const byRef = (await get('emma', '/search?q=TRN-000002').expect(200)).body.data.filter(
      (h: { module: string }) => h.module === 'training',
    );
    expect(byRef).toEqual([
      expect.objectContaining({
        type: 'training_request',
        reference: 'TRN-000002',
        title: 'First Aid at Work Refresher',
      }),
    ]);
    const hidden = (await get('arne', '/search?q=TRN-000002').expect(200)).body.data.filter(
      (h: { module: string }) => h.module === 'training',
    );
    expect(hidden).toEqual([]);
    const byTopic = (await get('tina', '/search?q=leadership').expect(200)).body.data.filter(
      (h: { module: string }) => h.module === 'training',
    );
    expect(byTopic.length).toBeGreaterThanOrEqual(3);
    expect(byTopic.length).toBeLessThanOrEqual(5);
    const byName = (await get('max', '/search?q=emma').expect(200)).body.data.filter(
      (h: { type: string }) => h.type === 'training_participation',
    );
    expect(byName[0]).toMatchObject({ title: 'Emma Employee: Customer Communication Masterclass' });
  });

  it('my-day contributes upcoming trainings (next 30 days)', async () => {
    const emma = await t.userId('emma');
    const user = {
      id: emma,
      email: 'emma.employee@example.com',
      displayName: 'Emma Employee',
      roles: ['employee' as const],
      isSiteManager: false,
      sessionId: null,
    };
    const myDay = await t.app.get(InboxService).myDay(user);
    const training = myDay.upcoming.filter((u) => u.module === 'training');
    expect(training.map((u) => u.title)).toEqual(['First Aid at Work Refresher', 'Customer Communication Masterclass']);
    expect(training[0]).toMatchObject({
      kind: 'training',
      status: 'booked',
      subtitle: 'Harbor Training Group · Booked · HTG-20417',
    });
  });

  it('booking documents follow participation visibility', async () => {
    const id = await attendeeId(t, 17); // Helen, booked with a document
    const doc = await t.prisma.attachment.findFirstOrThrow({
      where: { entityType: 'training_attendee', entityId: id },
    });
    await get('helen', `/attachments/${doc.id}/download-url`).expect(200);
    await get('tina', `/attachments/${doc.id}`).expect(200);
    await get('emma', `/attachments/${doc.id}`).expect(404);
    const agenda = await t.prisma.attachment.findFirstOrThrow({ where: { purpose: 'training_document' } });
    await get('max', `/attachments/${agenda.id}`).expect(200);
    await get('arne', `/attachments/${agenda.id}`).expect(404);
  });

  it('registers enums, the workflow diagram and audit labels', async () => {
    const enums = (await get('emma', '/meta/enums').expect(200)).body;
    expect(enums.attendeeStatus.find((o: { value: string }) => o.value === 'pending_manager_approval')).toMatchObject({
      label: 'Awaiting manager',
      tone: 'waiting',
    });
    expect(Object.keys(enums)).toEqual(
      expect.arrayContaining(['trainingFormat', 'billingStatus', 'ratingState', 'likert', 'improvement']),
    );
    const wf = (await get('emma', '/meta/workflows/training_attendee').expect(200)).body;
    expect(wf.initialStates).toEqual(['pending_manager_approval', 'pending_executive_approval', 'to_book']);
    expect(wf.transitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'pending_manager_approval',
          to: 'pending_executive_approval',
          event: 'approve',
        }),
        expect.objectContaining({ from: 'booking_impossible', to: 'cancelled', event: 'close' }),
        expect.objectContaining({ from: 'cancellation_requested', to: 'booked', event: 'reject_cancellation' }),
        expect.objectContaining({ from: 'booked', to: 'attended', event: 'submit_rating_1' }),
      ]),
    );
    expect(wf.states.find((s: { id: string }) => s.id === 'declined')).toMatchObject({
      terminal: true,
      tone: 'negative',
    });
  });

  it('renders every training mail template in the dev preview', async () => {
    for (const id of [
      'training.participation_created',
      'training.approval_requested',
      'training.executive_approval_requested',
      'training.participation_approved',
      'training.participation_declined',
      'training.participation_withdrawn',
      'training.booking_requested',
      'training.participation_booked',
      'training.booking_impossible',
      'training.cancellation_requested',
      'training.cancellation_confirmed',
      'training.cancellation_rejected',
      'training.goals_reminder',
      'training.rating_due',
    ]) {
      const res = await t.http().get(`${API}/dev/mail-preview/${id}?format=text`).set('Authorization', auth.ian);
      expect(res.status, id).toBe(200);
    }
  });
});
