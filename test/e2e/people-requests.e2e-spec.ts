import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../support/test-app';

const PDF = Buffer.from('%PDF-1.7\n% people document\n');

interface Detail {
  id: string;
  reference: string;
  status: string;
  availableActions: string[];
  personalData: Record<string, unknown> | null;
  personalDataRedacted: boolean;
  internalNote: string | null;
  openQuestion: { body: string; kind: string } | null;
  assignee: { displayName: string } | null;
  statusReason: string | null;
  closedAt: string | null;
  version: number;
  attachments: { id: string }[];
  manager: { displayName: string } | null;
  firstName: string;
  lastName: string;
  department: { code: string } | null;
}

/**
 * People requests (SPEC §3.4, §5.4; API.md §7.1): visibility and personal data, every
 * transition and its permissions, edits, comments, notifications, inbox, search, job roles.
 */
describe('people requests', () => {
  let t: TestApp;
  let emma: string;
  let max: string;
  let sofia: string;
  let paula: string;
  let ian: string;
  let tom: string;
  const ids: Record<string, string> = {};
  const roles: Record<string, string> = {};

  beforeAll(async () => {
    t = await createTestApp({ seed: ['core', 'people'] });
    [emma, max, sofia, paula, ian, tom] = await Promise.all(
      (['emma', 'max', 'sofia', 'paula', 'ian', 'tom'] as const).map((p) => t.login(p)),
    );
    for (const key of ['emma', 'max', 'sofia', 'paula', 'ian', 'tom']) ids[key] = await t.userId(key);
    for (const r of await t.prisma.jobRole.findMany()) roles[r.name] = r.id;
  });

  afterAll(async () => {
    await t?.close();
  });

  const api = '/api/v1/people/requests';
  const get = (auth: string, id: string) => t.http().get(`${api}/${id}`).set('Authorization', auth);
  const act = (auth: string, id: string, action: string, body: object = {}) =>
    t.http().post(`${api}/${id}/actions/${action}`).set('Authorization', auth).send(body);
  const comment = (auth: string, id: string, body: object) =>
    t.http().post(`${api}/${id}/comments`).set('Authorization', auth).send(body);
  const byRef = async (number: number) => (await t.prisma.peopleRequest.findUniqueOrThrow({ where: { number } })).id;
  const onboarding = (overrides: object = {}) => ({
    type: 'onboarding',
    title: 'Field Technician – Eastgate',
    priority: 'high',
    jobRoleId: roles['Field Technician'],
    salutation: 'mx',
    firstName: 'Kit',
    lastName: 'Marlow',
    effectiveDate: '2030-01-15',
    managerId: ids.sofia,
    personalData: {
      birthDate: '1996-04-01',
      nationality: 'de',
      privateAddress: { street: 'Oak Way', houseNumber: '5', postalCode: '12345', city: 'Eastgate', countryCode: 'de' },
      privatePhone: '555-0199',
      privateEmail: 'kit.marlow@example.com',
    },
    ...overrides,
  });
  const create = async (auth: string, body: object) =>
    (await t.http().post(api).set('Authorization', auth).send(body).expect(201)).body as Detail;

  describe('seeded story records', () => {
    it('gives Emma a reply to-do for PPL-000004 and its open question', async () => {
      const inbox = await t.http().get('/api/v1/me/inbox?module=people').set('Authorization', emma).expect(200);
      const id = await byRef(4);
      expect(inbox.body.data).toEqual([
        expect.objectContaining({
          id: `people.reply_required:${id}`,
          type: 'people.reply_required',
          reference: 'PPL-000004',
          title: 'Reply needed: Access to the dispatch planning board',
          subtitle: 'Which regions do you need to plan for?',
          link: `/people-requests/${id}`,
          actionsPath: `/people/requests/${id}`,
          quickActions: [],
        }),
      ]);
      const detail = (await get(emma, id).expect(200)).body as Detail;
      expect(detail.openQuestion).toMatchObject({ body: 'Which regions do you need to plan for?', kind: 'question' });
      expect(detail.availableActions).toEqual(['cancel', 'comment']);
    });

    it('gives People Ops the triage items (open/reopened, unassigned or mine), never it_admin', async () => {
      const inbox = await t.http().get('/api/v1/me/inbox?module=people').set('Authorization', paula).expect(200);
      expect(inbox.body.data.map((i: { reference: string }) => i.reference).sort()).toEqual([
        'PPL-000005',
        'PPL-000008',
        'PPL-000009',
      ]);
      const critical = inbox.body.data.find((i: { reference: string }) => i.reference === 'PPL-000008');
      expect(critical).toMatchObject({
        priority: 'high',
        title: 'Onboarding: Cloud Engineer – Campus',
        link: expect.stringContaining('/back-office/people?queue=open&selected='),
      });
      const asIan = await t.http().get('/api/v1/me/inbox?module=people').set('Authorization', ian).expect(200);
      expect(asIan.body.data).toEqual([]);
    });

    it('counts queues for people ops and the requester', async () => {
      const ops = await t.http().get('/api/v1/people/queues/counts').set('Authorization', paula).expect(200);
      expect(ops.body).toEqual({
        mine: { open: 0, waitingOnMe: 0 },
        ops: { open: 2, reopened: 1, inProgress: 3, waiting: 4, unassigned: 2, critical: 1 },
      });
      const mine = await t.http().get('/api/v1/people/queues/counts').set('Authorization', emma).expect(200);
      expect(mine.body).toEqual({ mine: { open: 1, waitingOnMe: 1 }, ops: null });
    });

    it('lists scope=mine (requester, manager, deputy) and scope=all for People Ops only', async () => {
      const mine = await t.http().get(`${api}?sort=effectiveDate`).set('Authorization', max).expect(200);
      expect(mine.body.data.map((r: { reference: string }) => r.reference).sort()).toEqual([
        'PPL-000001',
        'PPL-000002',
        'PPL-000003',
        'PPL-000004',
        'PPL-000009',
      ]);
      await t.http().get(`${api}?scope=all`).set('Authorization', emma).expect(403);
      const all = await t.http().get(`${api}?scope=all&perPage=100`).set('Authorization', paula).expect(200);
      expect(all.body.meta.total).toBe(15);
      const filtered = await t
        .http()
        .get(`${api}?scope=all&status=open,reopened&sort=priority`)
        .set('Authorization', paula)
        .expect(200);
      expect(filtered.body.data.map((r: { reference: string }) => r.reference)).toEqual([
        'PPL-000008',
        'PPL-000009',
        'PPL-000005',
      ]);
      const unassigned = await t.http().get(`${api}?scope=all&assigneeId=none`).set('Authorization', paula).expect(200);
      expect(unassigned.body.data.every((r: { assignee: unknown }) => r.assignee === null)).toBe(true);
      const ref = await t.http().get(`${api}?scope=all&q=ppl-000006`).set('Authorization', paula).expect(200);
      expect(ref.body.data.map((r: { reference: string }) => r.reference)).toEqual(['PPL-000006']);
      await t.http().get(`${api}?sort=title`).set('Authorization', paula).expect(422);
    });

    it('hides internal comments and notes from requesters', async () => {
      const id = await byRef(1);
      const asOps = (await t.http().get(`${api}/${id}/comments`).set('Authorization', paula).expect(200)).body;
      expect(asOps.filter((c: { internal: boolean }) => c.internal)).toHaveLength(1);
      const asRequester = (await t.http().get(`${api}/${id}/comments`).set('Authorization', max).expect(200)).body;
      expect(asRequester.length).toBe(asOps.length - 1);
      expect(asRequester.every((c: { internal: boolean }) => !c.internal)).toBe(true);
      expect((await get(max, id).expect(200)).body.internalNote).toBeNull();
    });

    it('searches people requests the user may see', async () => {
      const hit = await t.http().get('/api/v1/search?q=PPL-000004').set('Authorization', emma).expect(200);
      expect(hit.body.data).toEqual([
        expect.objectContaining({ module: 'people', type: 'people_request', reference: 'PPL-000004' }),
      ]);
      const none = await t.http().get('/api/v1/search?q=PPL-000004').set('Authorization', tom).expect(200);
      expect(none.body.data.filter((h: { module: string }) => h.module === 'people')).toEqual([]);
      const text = await t.http().get('/api/v1/search?q=dispatch').set('Authorization', paula).expect(200);
      expect(text.body.data.some((h: { reference: string }) => h.reference === 'PPL-000004')).toBe(true);
    });
  });

  describe('create', () => {
    it('validates per type (422 per field)', async () => {
      const res = await t
        .http()
        .post(api)
        .set('Authorization', emma)
        .send({ type: 'onboarding', title: 'New hire', subjectUserId: ids.max, effectiveDate: '2030-01-01' })
        .expect(422);
      expect(Object.keys(res.body.errors).sort()).toEqual([
        'firstName',
        'jobRoleId',
        'lastName',
        'managerId',
        'subjectUserId',
      ]);
      const off = await t
        .http()
        .post(api)
        .set('Authorization', emma)
        .send({ type: 'offboarding', title: 'Leaver', effectiveDate: '2030-01-01' })
        .expect(422);
      expect(Object.keys(off.body.errors)).toEqual(['subjectUserId']);
      await t
        .http()
        .post(api)
        .set('Authorization', emma)
        .send({ ...onboarding(), unknown: true })
        .expect(422);
      const bad = await t
        .http()
        .post(api)
        .set('Authorization', emma)
        .send(onboarding({ personalData: { nationality: 'Germany', privateEmail: 'nope' } }))
        .expect(422);
      expect(Object.keys(bad.body.errors).sort()).toEqual(['personalData.nationality', 'personalData.privateEmail']);
    });

    it('lets non-back-office requesters name only themselves or their team', async () => {
      const res = await t
        .http()
        .post(api)
        .set('Authorization', emma)
        .send({ type: 'offboarding', title: 'Max leaves', subjectUserId: ids.max, effectiveDate: '2030-01-01' })
        .expect(422);
      expect(res.body.errors).toEqual({ subjectUserId: ['You can only request for yourself or your team.'] });
      // it_admin and people_ops are exempt (SPEC_RESOLUTIONS #24).
      await create(ian, {
        type: 'offboarding',
        title: 'Max leaves',
        subjectUserId: ids.max,
        effectiveDate: '2030-01-01',
      });
    });

    it('allows a role change without a job role (SPEC_RESOLUTIONS #20) and defaults the manager', async () => {
      const req = await create(emma, {
        type: 'role_change',
        title: 'Access to the van pool calendar',
        subjectUserId: ids.emma,
        effectiveDate: '2030-02-01',
      });
      expect(req).toMatchObject({
        status: 'open',
        firstName: 'Emma',
        lastName: 'Employee',
        department: { code: 'FLD' },
      });
      expect(req.manager?.displayName).toBe('Max Manager');
    });

    it('creates an onboarding request: 201, Location, audit, mail to the people-ops mailbox', async () => {
      const res = await t.http().post(api).set('Authorization', max).send(onboarding()).expect(201);
      const req = res.body as Detail;
      expect(res.headers.location).toBe(`/api/v1/people/requests/${req.id}`);
      expect(req.reference).toMatch(/^PPL-0000(1[6-9]|[2-9]\d)$/);
      expect(req.status).toBe('open');
      expect(req.availableActions).toEqual(['cancel', 'edit', 'comment']);
      expect(req.personalData).toMatchObject({ nationality: 'DE', privateAddress: { countryCode: 'DE' } });
      const audit = await t.prisma.auditLog.findMany({ where: { entityId: req.id } });
      expect(audit).toEqual([expect.objectContaining({ action: 'create', actingAs: 'requester', toState: 'open' })]);
      const email = await t.prisma.emailMessage.findFirstOrThrow({ where: { entityId: req.id } });
      expect(email).toMatchObject({
        templateId: 'people.request_created',
        to: ['people-ops@example.com'],
        priority: 'high',
      });
      expect([...email.cc].sort()).toEqual(['max.manager@example.com', 'sofia.site-manager@example.com']);
      expect(JSON.stringify(email.payload)).not.toContain('1996-04-01');
      const inApp = await t.prisma.notification.findMany({ where: { entityId: req.id } });
      expect(inApp.map((n) => n.userId).sort()).toEqual([ids.max, ids.sofia].sort());
    });

    it('links people documents and shows them only to personal-data viewers (#25)', async () => {
      const upload = await t
        .http()
        .post('/api/v1/attachments')
        .set('Authorization', max)
        .field('purpose', 'people_document')
        .attach('file', PDF, 'contract.pdf')
        .expect(201);
      const req = await create(max, onboarding({ attachmentIds: [upload.body.id] }));
      expect(req.attachments.map((a) => a.id)).toEqual([upload.body.id]);
      const asIan = (await get(ian, req.id).expect(200)).body as Detail;
      expect(asIan).toMatchObject({ personalData: null, personalDataRedacted: true, attachments: [] });
      await t.http().get(`/api/v1/attachments/${upload.body.id}`).set('Authorization', ian).expect(404);
      await t.http().get(`/api/v1/attachments/${upload.body.id}/download-url`).set('Authorization', sofia).expect(200);
    });
  });

  describe('visibility (D5: invisible = 404)', () => {
    it('hides requests from unrelated users and from the subject', async () => {
      const req = await create(paula, {
        type: 'offboarding',
        title: 'Emma leaves',
        subjectUserId: ids.emma,
        effectiveDate: '2030-03-01',
      });
      // Emma is the subject, not a viewer.
      await get(emma, req.id).expect(404);
      await get(tom, req.id).expect(404);
      await t.http().patch(`${api}/${req.id}`).set('Authorization', tom).send({ title: 'Hijack' }).expect(404);
      await act(tom, req.id, 'cancel', { reason: 'Not mine' }).expect(404);
      await comment(tom, req.id, { body: 'Hello' }).expect(404);
      await t.http().get(`${api}/${req.id}/comments`).set('Authorization', tom).expect(404);
      await t.http().get(`${api}/${req.id}/timeline`).set('Authorization', tom).expect(404);
      await get(tom, 'not-a-uuid').expect(404);
      // The manager (Max, defaulted from the subject) sees it with personal data.
      const asMax = (await get(max, req.id).expect(200)).body as Detail;
      expect(asMax.personalDataRedacted).toBe(false);
    });

    it("shows the manager's deputy a read-only, redacted view", async () => {
      const req = await create(max, onboarding({ managerId: ids.max, managerDeputyId: ids.emma }));
      const asDeputy = (await get(emma, req.id).expect(200)).body as Detail;
      expect(asDeputy).toMatchObject({ personalData: null, personalDataRedacted: true, availableActions: [] });
      await comment(emma, req.id, { body: 'Can I help?' }).expect(403);
      await act(emma, req.id, 'cancel', { reason: 'Not needed' }).expect(403);
    });

    it('shows it_admin everything except personal data, including internal notes', async () => {
      const id = await byRef(6);
      const asIan = (await get(ian, id).expect(200)).body as Detail;
      expect(asIan).toMatchObject({
        personalData: null,
        personalDataRedacted: true,
        internalNote: 'Waiting for laptop from IT stock',
      });
      const asPriyaView = (await get(paula, id).expect(200)).body as Detail;
      expect(asPriyaView.personalData).toMatchObject({ nationality: 'SE' });
      const asSofia = await get(sofia, id).expect(404);
      expect(asSofia.body.code).toBe('not_found');
    });
  });

  describe('lifecycle (SPEC §5.4)', () => {
    it('runs every transition with permissions, comments and notifications', async () => {
      const req = await create(max, onboarding());
      const id = req.id;

      // open: only People Ops / IT may start work; complete is not available yet.
      expect((await act(max, id, 'start_work').expect(403)).body.code).toBe('forbidden');
      expect((await act(paula, id, 'complete').expect(409)).body.code).toBe('invalid_transition');
      await act(paula, id, 'fly').expect(404);
      await act(paula, id, 'start_work', { note: 'x'.repeat(2001) }).expect(422);

      let d = (await act(paula, id, 'start_work', { note: 'Accounts are on the way.' }).expect(200)).body as Detail;
      expect(d).toMatchObject({ status: 'in_progress', assignee: { displayName: 'Paula People-Ops' } });
      expect(d.availableActions).toEqual([
        'wait_internal',
        'wait_on_requester',
        'complete',
        'reject',
        'cancel',
        'edit',
        'edit_internal',
        'comment',
        'comment_internal',
      ]);

      // wait_internal: the note is internal and never mailed (#19).
      await act(paula, id, 'wait_internal', {}).expect(422);
      d = (await act(paula, id, 'wait_internal', { note: 'Laptop is not in stock yet' }).expect(200)).body as Detail;
      expect(d.status).toBe('waiting_internal');
      const requesterComments = (await t.http().get(`${api}/${id}/comments`).set('Authorization', max).expect(200))
        .body;
      expect(requesterComments.map((c: { body: string }) => c.body)).not.toContain('Laptop is not in stock yet');
      const waitMail = await t.prisma.emailMessage.findFirstOrThrow({
        where: { entityId: id, templateId: 'people.status_changed' },
        orderBy: { createdAt: 'desc' },
      });
      expect(JSON.stringify(waitMail.payload)).not.toContain('Laptop is not in stock yet');
      expect(waitMail.to).toEqual(['max.manager@example.com']);
      expect(waitMail.cc).toEqual(['sofia.site-manager@example.com']);

      d = (await act(paula, id, 'resume').expect(200)).body as Detail;
      expect(d.status).toBe('in_progress');

      // wait_on_requester: the question is a public comment and the open question.
      await act(paula, id, 'wait_on_requester', { question: '?' }).expect(422);
      d = (await act(paula, id, 'wait_on_requester', { question: 'Which van does Kit need?' }).expect(200))
        .body as Detail;
      expect(d).toMatchObject({ status: 'waiting_on_requester', openQuestion: { body: 'Which van does Kit need?' } });
      const askMail = await t.prisma.emailMessage.findFirstOrThrow({
        where: { entityId: id, templateId: 'people.status_changed' },
        orderBy: { createdAt: 'desc' },
      });
      expect(JSON.stringify(askMail.payload)).toContain('Which van does Kit need?');
      const maxInbox = await t.http().get('/api/v1/me/inbox?module=people').set('Authorization', max).expect(200);
      expect(maxInbox.body.data.map((i: { entityId: string }) => i.entityId)).toContain(id);

      // The requester's reply fires requester_replied -> in_progress and notifies the assignee.
      const reply = await comment(max, id, { body: 'The small van, please.' }).expect(201);
      expect(reply.body).toMatchObject({ kind: 'comment', internal: false, body: 'The small van, please.' });
      d = (await get(max, id).expect(200)).body as Detail;
      expect(d).toMatchObject({ status: 'in_progress', openQuestion: null });
      const replyMail = await t.prisma.emailMessage.findFirstOrThrow({
        where: { entityId: id, templateId: 'people.comment_added' },
        orderBy: { createdAt: 'desc' },
      });
      expect(replyMail.to).toEqual(['paula.people-ops@example.com']);

      // complete -> closedAt; requester may reopen within the window.
      d = (await act(paula, id, 'complete', { note: 'All set.' }).expect(200)).body as Detail;
      expect(d.status).toBe('completed');
      expect(d.closedAt).not.toBeNull();
      expect((await get(max, id).expect(200)).body.availableActions).toEqual(['reopen']);
      await act(max, id, 'reopen', { reason: 'no' }).expect(422);
      d = (await act(max, id, 'reopen', { reason: 'The van key is missing.' }).expect(200)).body as Detail;
      expect(d).toMatchObject({ status: 'reopened', closedAt: null, statusReason: 'The van key is missing.' });
      const reopenMail = await t.prisma.emailMessage.findFirstOrThrow({
        where: { entityId: id, templateId: 'people.status_changed' },
        orderBy: { createdAt: 'desc' },
      });
      // The requester acted: People Ops (the assignee) is told instead.
      expect(reopenMail.to).toEqual(['paula.people-ops@example.com']);

      // reopened -> start_work -> reject -> (ops) reopen -> cancel (requester).
      await act(ian, id, 'start_work').expect(200);
      d = (await act(paula, id, 'reject', { reason: 'Duplicate request.' }).expect(200)).body as Detail;
      expect(d).toMatchObject({ status: 'rejected', statusReason: 'Duplicate request.' });
      expect((await act(max, id, 'reopen', { reason: 'Please look again.' }).expect(403)).body.code).toBe('forbidden');
      await act(paula, id, 'reopen', { reason: 'Not a duplicate after all.' }).expect(200);
      await act(sofia, id, 'cancel', { reason: 'Manager wants out.' }).expect(403);
      d = (await act(max, id, 'cancel', { reason: 'Candidate withdrew.' }).expect(200)).body as Detail;
      expect(d).toMatchObject({ status: 'cancelled', statusReason: 'Candidate withdrew.', availableActions: [] });
      expect((await act(paula, id, 'reopen', { reason: 'Back again.' }).expect(409)).body.code).toBe(
        'invalid_transition',
      );

      const timeline = (await t.http().get(`${api}/${id}/timeline`).set('Authorization', max).expect(200)).body as {
        action: string;
        actingAs: string;
      }[];
      expect(timeline.map((e) => e.action)).toEqual([
        'create',
        'start_work',
        'wait_internal',
        'resume',
        'wait_on_requester',
        'requester_replied',
        'complete',
        'reopen',
        'start_work',
        'reject',
        'reopen',
        'cancel',
      ]);
      expect(timeline[8].actingAs).toBe('admin');
      expect(timeline[7].actingAs).toBe('requester');
    });

    it('lets the requester reopen a completed request only within PEOPLE_REOPEN_WINDOW_DAYS', async () => {
      const req = await create(max, onboarding());
      await act(paula, req.id, 'start_work').expect(200);
      await act(paula, req.id, 'complete').expect(200);
      // Closed 31 days ago (sessions follow the Clock, so move the row instead of the clock).
      await t.prisma.peopleRequest.update({
        where: { id: req.id },
        data: { closedAt: new Date(Date.now() - 31 * 86_400_000) },
      });
      expect((await get(max, req.id).expect(200)).body.availableActions).toEqual([]);
      await act(max, req.id, 'reopen', { reason: 'Too late?' }).expect(403);
      await act(paula, req.id, 'reopen', { reason: 'People Ops can.' }).expect(200);
    });
  });

  describe('edit (PATCH)', () => {
    it('lets the requester edit create fields while open, with a masked audit diff', async () => {
      const req = await create(max, onboarding());
      const res = await t
        .http()
        .patch(`${api}/${req.id}`)
        .set('Authorization', max)
        .send({
          title: 'Field Technician – Eastgate (van)',
          priority: 'critical',
          personalData: { privatePhone: '555-0111' },
          version: req.version,
        })
        .expect(200);
      expect(res.body).toMatchObject({ priority: 'critical', version: req.version + 1 });
      const audit = await t.prisma.auditLog.findFirstOrThrow({ where: { entityId: req.id, action: 'update' } });
      const changes = audit.changes as { field: string; from: unknown; to: unknown }[];
      expect(changes.find((c) => c.field === 'privatePhone')).toMatchObject({ from: '•••', to: '•••' });
      expect(changes.find((c) => c.field === 'priority')).toMatchObject({ from: 'high', to: 'critical' });
      // stale version
      expect(
        (
          await t
            .http()
            .patch(`${api}/${req.id}`)
            .set('Authorization', max)
            .send({ title: 'Again', version: 1 })
            .expect(409)
        ).body.code,
      ).toBe('version_conflict');
      // internal fields need People Ops
      await t.http().patch(`${api}/${req.id}`).set('Authorization', max).send({ internalNote: 'x' }).expect(403);
      // the manager may not edit
      await t.http().patch(`${api}/${req.id}`).set('Authorization', sofia).send({ title: 'Mine now' }).expect(403);
      // after start_work only People Ops edits
      await act(paula, req.id, 'start_work').expect(200);
      await t.http().patch(`${api}/${req.id}`).set('Authorization', max).send({ title: 'Too late' }).expect(403);
      const ops = await t
        .http()
        .patch(`${api}/${req.id}`)
        .set('Authorization', paula)
        .send({ internalNote: 'Van ordered', assigneeId: ids.paula, effectiveDate: '2030-01-20' })
        .expect(200);
      expect(ops.body).toMatchObject({ internalNote: 'Van ordered', effectiveDate: '2030-01-20' });
      const asMax = (await get(max, req.id).expect(200)).body as Detail;
      expect(asMax.internalNote).toBeNull();
      const bad = await t
        .http()
        .patch(`${api}/${req.id}`)
        .set('Authorization', paula)
        .send({ assigneeId: ids.tom })
        .expect(422);
      expect(Object.keys(bad.body.errors)).toEqual(['assigneeId']);
      // it_admin: fields yes, personal data never (#24)
      await t.http().patch(`${api}/${req.id}`).set('Authorization', ian).send({ title: 'Edited by IT' }).expect(200);
      await t
        .http()
        .patch(`${api}/${req.id}`)
        .set('Authorization', ian)
        .send({ personalData: { privatePhone: '555-0000' } })
        .expect(403);
      // closed: People Ops can no longer edit fields
      await act(paula, req.id, 'complete').expect(200);
      expect(
        (await t.http().patch(`${api}/${req.id}`).set('Authorization', paula).send({ title: 'Closed' }).expect(409))
          .body.code,
      ).toBe('invalid_transition');
    });
  });

  describe('comments (#19)', () => {
    it('notifies by role and keeps internal comments internal', async () => {
      const req = await create(max, onboarding());
      await comment(max, req.id, { body: 'Internal?', internal: true }).expect(403);
      await comment(max, req.id, { body: '' }).expect(422);

      // manager comment -> requester + People Ops (mailbox while unassigned)
      await comment(sofia, req.id, { body: 'I will meet Kit at the gate.' }).expect(201);
      const managerMail = await t.prisma.emailMessage.findFirstOrThrow({
        where: { entityId: req.id, templateId: 'people.comment_added' },
      });
      expect(managerMail.to.sort()).toEqual(['max.manager@example.com', 'people-ops@example.com']);

      const internal = await comment(paula, req.id, { body: 'Background check pending.', internal: true }).expect(201);
      expect(internal.body).toMatchObject({ internal: true, kind: 'comment' });
      const mails = await t.prisma.emailMessage.count({
        where: { entityId: req.id, templateId: 'people.comment_added' },
      });
      expect(mails).toBe(1);
      const asMax = await t.http().get(`${api}/${req.id}/comments`).set('Authorization', max).expect(200);
      expect(asMax.body.map((c: { body: string }) => c.body)).toEqual(['I will meet Kit at the gate.']);

      // ops comment -> requester
      await comment(paula, req.id, { body: 'Kit gets a badge on day one.' }).expect(201);
      const opsMail = await t.prisma.emailMessage.findFirstOrThrow({
        where: { entityId: req.id, templateId: 'people.comment_added' },
        orderBy: { createdAt: 'desc' },
      });
      expect(opsMail.to).toEqual(['max.manager@example.com']);

      await act(paula, req.id, 'reject', { reason: 'Hiring freeze.' }).expect(200);
      expect((await comment(max, req.id, { body: 'Why?' }).expect(409)).body.code).toBe('invalid_transition');
      await comment(paula, req.id, { body: 'Note for later.', internal: true }).expect(201);
    });
  });

  describe('job roles', () => {
    it('lists active roles for everyone and lets People Ops manage them', async () => {
      const list = await t.http().get('/api/v1/people/job-roles').set('Authorization', emma).expect(200);
      expect(list.body).toHaveLength(37);
      expect(list.body[0]).toEqual({
        id: expect.any(String),
        name: 'Account Manager',
        category: 'Sales',
        active: true,
      });
      await t.http().post('/api/v1/people/job-roles').set('Authorization', emma).send({ name: 'Pilot' }).expect(403);
      const created = await t
        .http()
        .post('/api/v1/people/job-roles')
        .set('Authorization', paula)
        .send({ name: 'Fleet Coordinator', category: 'Logistics' })
        .expect(201);
      expect(
        (
          await t
            .http()
            .post('/api/v1/people/job-roles')
            .set('Authorization', ian)
            .send({ name: 'fleet coordinator' })
            .expect(409)
        ).body.code,
      ).toBe('conflict');
      await t
        .http()
        .patch(`/api/v1/people/job-roles/${created.body.id}`)
        .set('Authorization', paula)
        .send({ active: false })
        .expect(200);
      expect(
        (await t.http().get('/api/v1/people/job-roles').set('Authorization', paula).expect(200)).body,
      ).toHaveLength(37);
      expect(
        (await t.http().get('/api/v1/people/job-roles?includeInactive=true').set('Authorization', paula).expect(200))
          .body,
      ).toHaveLength(38);
      // inactive roles cannot be chosen
      const res = await t
        .http()
        .post(api)
        .set('Authorization', max)
        .send(onboarding({ jobRoleId: created.body.id }))
        .expect(422);
      expect(Object.keys(res.body.errors)).toEqual(['jobRoleId']);
    });
  });

  describe('meta', () => {
    it('registers enums and the workflow diagram', async () => {
      const enums = await t.http().get('/api/v1/meta/enums').set('Authorization', emma).expect(200);
      expect(enums.body.peopleRequestStatus).toContainEqual({
        value: 'waiting_on_requester',
        label: 'Waiting on requester',
        tone: 'waiting',
        description: null,
      });
      expect(enums.body.priority.map((o: { value: string }) => o.value)).toEqual(['critical', 'high', 'normal', 'low']);
      expect(enums.body.peopleRequestType).toContainEqual(
        expect.objectContaining({ value: 'role_change', label: 'Role or access change' }),
      );
      const wf = await t.http().get('/api/v1/meta/workflows/people_request').set('Authorization', emma).expect(200);
      expect(wf.body.transitions).toContainEqual(
        expect.objectContaining({ from: 'waiting_on_requester', to: 'in_progress', event: 'requester_replied' }),
      );
    });
  });
});
