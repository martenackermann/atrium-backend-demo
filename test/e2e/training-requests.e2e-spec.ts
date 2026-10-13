import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../support/test-app';
import { API, attendeeId, attendeesOf, d, EMAILS, loginEmail, money, PDF, requestBody } from './training-helpers';

/** `/training/requests*` (API.md §4.1): create, preview, visibility, edits, attendees, documents. */
describe('training requests', () => {
  let t: TestApp;
  let emma: string;
  let max: string;
  let sofia: string;
  let tina: string;
  let ian: string;
  let arne: string;
  let clara: string;
  let helen: string;
  let ids: Record<string, string>;

  beforeAll(async () => {
    t = await createTestApp({ seed: ['core', 'training'] });
    [emma, max, sofia, tina, ian, arne, clara] = await Promise.all(
      (['emma', 'max', 'sofia', 'tina', 'ian', 'arne', 'clara'] as const).map((p) => t.login(p)),
    );
    helen = await loginEmail(t, EMAILS.helen);
    ids = {
      emma: await t.userId('emma'),
      max: await t.userId('max'),
      sofia: await t.userId('sofia'),
      clara: await t.userId('clara'),
      arne: await t.userId('arne'),
      helen: await t.userId(EMAILS.helen),
    };
  });

  afterAll(async () => {
    await t?.close();
  });

  const post = (auth: string, path: string, body: object) =>
    t.http().post(`${API}${path}`).set('Authorization', auth).send(body);
  const get = (auth: string, path: string) => t.http().get(`${API}${path}`).set('Authorization', auth);
  const patch = (auth: string, path: string, body: object) =>
    t.http().patch(`${API}${path}`).set('Authorization', auth).send(body);

  describe('create', () => {
    it('creates a self request routed to the direct manager (201 + Location)', async () => {
      const res = await post(emma, '/training/requests', requestBody([{ userId: ids.emma }])).expect(201);
      expect(res.headers.location).toBe(`/api/v1/training/requests/${res.body.id}`);
      expect(res.body).toMatchObject({
        reference: expect.stringMatching(/^TRN-0000(3[1-9]|[4-9]\d)$/),
        attendeeCount: 1,
        statusCounts: { pending_manager_approval: 1 },
        executiveStepRequired: false,
        backOffice: null,
        actualCost: null,
        availableActions: ['edit', 'add_attendee', 'add_attachment'],
      });
      expect(res.body.attendees[0]).toMatchObject({
        status: 'pending_manager_approval',
        approver: { id: ids.max },
        approverReason: 'direct_manager',
        escalatedFrom: null,
        availableActions: ['withdraw', 'edit_goals'],
      });
      const audit = await t.prisma.auditLog.findMany({ where: { entityId: res.body.attendees[0].id } });
      expect(audit.map((a) => a.action)).toEqual(['create']);
      const mails = await t.prisma.emailMessage.findMany({ where: { entityId: res.body.attendees[0].id } });
      expect(mails.map((m) => m.templateId).sort()).toEqual(['training.approval_requested', 'training.participation_created']);
    });

    it('auto-approves when the requester is the resolved approver and notifies training.participation_approved (#28)', async () => {
      const res = await post(max, '/training/requests', requestBody([{ userId: ids.emma }])).expect(201);
      const attendee = res.body.attendees[0];
      expect(attendee).toMatchObject({
        status: 'to_book',
        managerDecision: { actingAs: 'system', autoApproval: 'requester_is_approver', by: { id: ids.max } },
      });
      const templates = (await t.prisma.emailMessage.findMany({ where: { entityId: attendee.id } })).map((m) => m.templateId);
      expect(templates).toEqual(
        expect.arrayContaining(['training.participation_created', 'training.participation_approved', 'training.booking_requested']),
      );
      const audit = await t.prisma.auditLog.findMany({ where: { entityId: attendee.id }, orderBy: { occurredAt: 'asc' } });
      expect(audit.map((a) => [a.action, a.reason])).toEqual([
        ['create', null],
        ['auto_approve', 'requester_is_approver'],
      ]);
    });

    it('escalates past a site manager and persists escalatedFrom (#2)', async () => {
      const { attendees } = await attendeesOf(t, 7);
      const res = await post(
        sofia,
        '/training/requests',
        requestBody([{ userId: attendees[0].userId }, { userId: attendees[1].userId }]),
      ).expect(201);
      expect(res.body.attendees).toHaveLength(2);
      for (const a of res.body.attendees) {
        expect(a).toMatchObject({
          approver: { id: ids.max },
          approverReason: 'site_manager_escalation',
          escalatedFrom: { id: ids.sofia },
        });
      }
    });

    it('auto-approves both steps for an executive attendee (executive_self)', async () => {
      const res = await post(
        helen,
        '/training/requests',
        requestBody([{ userId: ids.helen }], { cost: money(600000), executiveApproverId: ids.clara }),
      ).expect(201);
      expect(res.body.attendees[0]).toMatchObject({
        status: 'to_book',
        approverReason: 'executive_self',
        managerDecision: { autoApproval: 'executive_self' },
        executiveDecision: { autoApproval: 'executive_self' },
      });
    });

    it('requester = approver but another executive -> pending executive approval', async () => {
      const res = await post(
        max,
        '/training/requests',
        requestBody([{ userId: ids.emma }], { cost: money(500000), executiveApproverId: ids.clara }),
      ).expect(201);
      expect(res.body.attendees[0]).toMatchObject({
        status: 'pending_executive_approval',
        executiveApprover: { id: ids.clara },
        managerDecision: { autoApproval: 'requester_is_approver' },
        executiveDecision: null,
      });
      expect(res.body.executiveStepRequired).toBe(true);
    });

    it('requester is the resolved approver and the executive approver -> to_book (same_approver)', async () => {
      const grace = await t.userId(EMAILS.grace);
      const res = await post(
        clara,
        '/training/requests',
        requestBody([{ userId: grace }], { cost: money(700000), executiveApproverId: ids.clara }),
      ).expect(201);
      expect(res.body.attendees[0]).toMatchObject({
        status: 'to_book',
        managerDecision: { autoApproval: 'requester_is_approver' },
        executiveDecision: { autoApproval: 'same_approver' },
      });
    });

    it('rejects attendees outside the reporting tree (422 attendees.0.userId)', async () => {
      const res = await post(emma, '/training/requests', requestBody([{ userId: ids.arne }])).expect(422);
      expect(res.body.code).toBe('validation_failed');
      expect(Object.keys(res.body.errors)).toEqual(['attendees.0.userId']);
    });

    it('lets the training office request for anyone, also with a past start', async () => {
      const res = await post(
        tina,
        '/training/requests',
        requestBody([{ userId: ids.arne }], { startsOn: d(-1), endsOn: d(-1) }),
      ).expect(201);
      expect(res.body.attendees[0].status).toBe('pending_manager_approval');
    });

    it('validates fields (422 with dot paths)', async () => {
      const res = await post(
        emma,
        '/training/requests',
        requestBody([{ userId: ids.emma }, { userId: ids.emma }], {
          format: 'in_person',
          startsOn: d(-2),
          endsOn: d(-3),
          registrationUrl: 'http://insecure.example.com',
          attendees: [
            { userId: ids.emma, hotel: { checkInOn: d(30), checkOutOn: d(29) } },
            { userId: ids.emma },
          ],
        }),
      ).expect(422);
      expect(Object.keys(res.body.errors).sort()).toEqual(['attendees.1.userId', 'registrationUrl']);

      const res2 = await post(
        emma,
        '/training/requests',
        requestBody([{ userId: ids.emma }], {
          format: 'in_person',
          startsOn: d(-2),
          endsOn: d(-3),
          attendees: [{ userId: ids.emma, hotel: { checkInOn: d(30), checkOutOn: d(29) } }],
        }),
      ).expect(422);
      expect(Object.keys(res2.body.errors).sort()).toEqual([
        'attendees.0.hotel.checkInOn',
        'attendees.0.hotel.checkOutOn',
        'endsOn',
        'location',
        'startsOn',
      ]);
    });

    it('requires an active executive from the threshold and rejects one below it (#28)', async () => {
      const missing = await post(emma, '/training/requests', requestBody([{ userId: ids.emma }], { cost: money(500000) }));
      expect(missing.status).toBe(422);
      expect(missing.body.errors).toHaveProperty('executiveApproverId');
      const notExec = await post(
        emma,
        '/training/requests',
        requestBody([{ userId: ids.emma }], { cost: money(500000), executiveApproverId: ids.max }),
      ).expect(422);
      expect(notExec.body.errors).toHaveProperty('executiveApproverId');
      const below = await post(
        emma,
        '/training/requests',
        requestBody([{ userId: ids.emma }], { cost: money(10000), executiveApproverId: ids.clara }),
      ).expect(422);
      expect(below.body.errors).toHaveProperty('executiveApproverId');
    });

    it('rejects unknown keys (strict bodies)', async () => {
      const res = await post(emma, '/training/requests', { ...requestBody([{ userId: ids.emma }]), extra: 1 }).expect(422);
      expect(res.body.code).toBe('validation_failed');
    });
  });

  describe('preview (#15)', () => {
    it('returns routing, deputies, auto-approvals and initial states', async () => {
      const { attendees } = await attendeesOf(t, 8);
      const res = await post(clara, '/training/requests/preview', {
        cost: money(510000),
        executiveApproverId: ids.clara,
        attendees: [{ userId: attendees[0].userId }, { userId: (await attendeesOf(t, 12)).attendees[0].userId }],
      }).expect(200);
      expect(res.body.executiveStepRequired).toBe(true);
      expect(res.body.executiveCandidates.map((u: { id: string }) => u.id).sort()).toEqual([ids.clara, ids.helen].sort());
      expect(res.body.executiveApprover).toMatchObject({ id: ids.clara });
      const [agent, grace] = res.body.attendees;
      expect(agent).toMatchObject({
        approverReason: 'direct_manager',
        activeDeputies: [{ id: ids.max }],
        allowed: true,
        initialState: 'pending_manager_approval',
      });
      expect(grace).toMatchObject({
        approver: { id: ids.clara },
        autoApproval: 'requester_is_approver',
        initialState: 'to_book',
        executiveAutoApproval: 'same_approver',
      });
    });

    it('accepts an empty attendee list and flags people outside the team', async () => {
      const empty = await post(emma, '/training/requests/preview', { attendees: [] }).expect(200);
      expect(empty.body).toMatchObject({ executiveStepRequired: false, attendees: [] });
      const res = await post(emma, '/training/requests/preview', { attendees: [{ userId: ids.arne }] }).expect(200);
      expect(res.body.attendees[0]).toMatchObject({
        allowed: false,
        notAllowedReason: 'You can only request for yourself or your team',
      });
    });
  });

  describe('visibility and lists', () => {
    it('hides other people\'s requests (404) but shows them to the back office', async () => {
      const { request } = await attendeesOf(t, 1);
      await get(arne, `/training/requests/${request.id}`).expect(404);
      await get(emma, `/training/requests/${request.id}`).expect(200);
      await get(max, `/training/requests/${request.id}`).expect(200);
      const office = await get(ian, `/training/requests/${request.id}`).expect(200);
      expect(office.body.backOffice).toMatchObject({ billingStatus: 'open' });
      await get(emma, '/training/requests/not-a-uuid').expect(404);
    });

    it('lists created requests, filters and sorts; scope=all needs the back office', async () => {
      const mine = await get(emma, '/training/requests?scope=created&sort=startsOn&perPage=100').expect(200);
      expect(mine.body.data.every((r: { requester: { id: string } }) => r.requester.id === ids.emma)).toBe(true);
      await get(emma, '/training/requests?scope=all').expect(403);
      const all = await get(tina, '/training/requests?scope=all&billingStatus=invoice_received').expect(200);
      expect(all.body.meta.total).toBe(5);
      expect(all.body.data[0].actualCost).not.toBeNull();
      const byRef = await get(tina, '/training/requests?scope=all&q=trn-000007').expect(200);
      expect(byRef.body.data.map((r: { reference: string }) => r.reference)).toEqual(['TRN-000007']);
      await get(tina, '/training/requests?scope=all&sort=nope').expect(422);
      const statusFilter = await get(tina, '/training/requests?scope=all&attendeeStatus=booking_impossible').expect(200);
      expect(statusFilter.body.data.map((r: { reference: string }) => r.reference)).toEqual(['TRN-000016']);
    });

    it('returns only visible attendee rows on the request detail', async () => {
      const { request } = await attendeesOf(t, 8);
      const asMax = await get(max, `/training/requests/${request.id}`).expect(200); // deputy for Priya
      expect(asMax.body.attendees).toHaveLength(2);
      expect(asMax.body.attendees[0].availableActions).toEqual(['approve', 'decline']);
    });
  });

  describe('edit', () => {
    it('lets the requester edit while all attendees await the manager, with a field diff', async () => {
      const created = await post(emma, '/training/requests', requestBody([{ userId: ids.emma }])).expect(201);
      const res = await patch(emma, `/training/requests/${created.body.id}`, {
        topic: 'Incident Communication Advanced',
        version: created.body.version,
      }).expect(200);
      expect(res.body).toMatchObject({ topic: 'Incident Communication Advanced', version: created.body.version + 1 });
      const audit = await t.prisma.auditLog.findFirstOrThrow({
        where: { entityId: created.body.id, action: 'update' },
      });
      expect(audit.changes).toEqual([
        expect.objectContaining({ field: 'topic', from: 'Incident Communication Basics', to: 'Incident Communication Advanced' }),
      ]);
      await patch(emma, `/training/requests/${created.body.id}`, { topic: 'Again', version: 1 }).expect(409);
      await patch(arne, `/training/requests/${created.body.id}`, { topic: 'Nope' }).expect(404);
      await patch(max, `/training/requests/${created.body.id}`, { topic: 'Nope' }).expect(403);
    });

    it('closes the requester window once an attendee passed the manager step (409)', async () => {
      const { request } = await attendeesOf(t, 2);
      const res = await patch(emma, `/training/requests/${request.id}`, { topic: 'Changed' }).expect(409);
      expect(res.body.code).toBe('conflict');
    });

    it('lets the back office edit details anytime but the cost only inside the window', async () => {
      const { request } = await attendeesOf(t, 2);
      await patch(tina, `/training/requests/${request.id}`, { location: 'Campus' }).expect(200);
      await patch(tina, `/training/requests/${request.id}`, { cost: money(30000) }).expect(409);
    });

    it('re-evaluates the executive step when the cost crosses the threshold', async () => {
      const created = await post(emma, '/training/requests', requestBody([{ userId: ids.emma }])).expect(201);
      await patch(emma, `/training/requests/${created.body.id}`, { cost: money(550000) }).expect(422);
      const res = await patch(emma, `/training/requests/${created.body.id}`, {
        cost: money(550000),
        executiveApproverId: ids.clara,
      }).expect(200);
      expect(res.body).toMatchObject({ executiveStepRequired: true, executiveApprover: { id: ids.clara } });
      expect(res.body.attendees[0].executiveApprover).toMatchObject({ id: ids.clara });
      const lowered = await patch(emma, `/training/requests/${created.body.id}`, { cost: money(1000) }).expect(200);
      expect(lowered.body).toMatchObject({ executiveStepRequired: false, executiveApprover: null });
      expect(lowered.body.attendees[0].executiveApprover).toBeNull();
    });

    it('back-office fields: training office only; free_of_charge forces actual cost 0', async () => {
      const { request } = await attendeesOf(t, 3);
      await patch(emma, `/training/requests/${request.id}/back-office`, { billingStatus: 'free_of_charge' }).expect(403);
      const res = await patch(tina, `/training/requests/${request.id}/back-office`, {
        billingStatus: 'free_of_charge',
        actualCost: money(12345),
        backOfficeComment: 'Sponsored seat',
      }).expect(200);
      expect(res.body.backOffice).toEqual({ comment: 'Sponsored seat', billingStatus: 'free_of_charge', actualCost: money(0) });
      const asEmma = await get(emma, `/training/requests/${request.id}`).expect(200);
      expect(asEmma.body.backOffice).toBeNull();
      expect(asEmma.body.actualCost).toBeNull();
    });
  });

  describe('attendees and documents', () => {
    it('adds an attendee (201), refuses duplicates (409) and people outside the team (422)', async () => {
      const created = await post(max, '/training/requests', requestBody([{ userId: ids.max }])).expect(201);
      const res = await post(max, `/training/requests/${created.body.id}/attendees`, {
        userId: ids.emma,
        hotel: { checkInOn: d(19), checkOutOn: d(21), cost: money(18000) },
      }).expect(201);
      expect(res.headers.location).toBe(`/api/v1/training/participations/${res.body.id}`);
      expect(res.body).toMatchObject({
        status: 'to_book',
        hotel: { checkInOn: d(19), checkOutOn: d(21), cost: money(18000) },
      });
      await post(max, `/training/requests/${created.body.id}/attendees`, { userId: ids.emma }).expect(409);
      const outside = await post(max, `/training/requests/${created.body.id}/attendees`, { userId: ids.arne }).expect(422);
      expect(Object.keys(outside.body.errors)).toEqual(['userId']);
      await post(emma, `/training/requests/${created.body.id}/attendees`, { userId: ids.emma }).expect(403);
    });

    it('refuses attendees once the training started (409)', async () => {
      const { request } = await attendeesOf(t, 3);
      await post(emma, `/training/requests/${request.id}/attendees`, { userId: ids.emma }).expect(409);
    });

    it('links staged documents, lists and removes them', async () => {
      const upload = await t
        .http()
        .post(`${API}/attachments`)
        .set('Authorization', emma)
        .field('purpose', 'training_document')
        .attach('file', PDF, 'agenda.pdf')
        .expect(201);
      const created = await post(emma, '/training/requests', requestBody([{ userId: ids.emma }])).expect(201);
      const linked = await post(emma, `/training/requests/${created.body.id}/attachments`, {
        attachmentIds: [upload.body.id],
      }).expect(200);
      expect(linked.body.map((a: { id: string }) => a.id)).toEqual([upload.body.id]);
      // visible through the attachment policy for the approver, not for others
      await get(max, `/attachments/${upload.body.id}`).expect(200);
      await get(arne, `/attachments/${upload.body.id}`).expect(404);
      await t
        .http()
        .delete(`${API}/training/requests/${created.body.id}/attachments/${upload.body.id}`)
        .set('Authorization', max)
        .expect(403);
      await t
        .http()
        .delete(`${API}/training/requests/${created.body.id}/attachments/${upload.body.id}`)
        .set('Authorization', emma)
        .expect(204);
      const detail = await get(emma, `/training/requests/${created.body.id}`).expect(200);
      expect(detail.body.attachments).toEqual([]);
    });

    it('shows the request timeline with attendee labels', async () => {
      const { request } = await attendeesOf(t, 2);
      const res = await get(emma, `/training/requests/${request.id}/timeline`).expect(200);
      expect(res.body.map((e: { action: string }) => e.action)).toEqual(
        expect.arrayContaining(['create', 'approve', 'book']),
      );
      expect(res.body.find((e: { action: string }) => e.action === 'approve')).toMatchObject({
        entityLabel: 'Emma Employee',
        summary: 'Max Manager approved',
      });
      await get(arne, `/training/requests/${request.id}/timeline`).expect(404);
    });

    it('seeds a coherent request number sequence', async () => {
      const created = await post(emma, '/training/requests', requestBody([{ userId: ids.emma }])).expect(201);
      expect(Number(created.body.reference.slice(4))).toBeGreaterThan(30);
      expect(await attendeeId(t, 1)).toBeTruthy();
    });
  });
});
