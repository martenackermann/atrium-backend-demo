import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../support/test-app';
import { API, attendeeId, attendeesOf, d, EMAILS, loginEmail, money, requestBody } from './training-helpers';

/**
 * Every transition of the attendee machine (SPEC §5.1 + SPEC_RESOLUTIONS #11) over HTTP, with
 * its guards, permission matrix rows (SPEC §3.1), 403/404/409/422 semantics and side effects.
 */
describe('training participation workflow', () => {
  let t: TestApp;
  let emma: string;
  let max: string;
  let sofia: string;
  let clara: string;
  let tina: string;
  let ian: string;
  let arne: string;
  let helen: string;
  let victor: string;
  let ids: Record<string, string>;

  beforeAll(async () => {
    t = await createTestApp({ seed: ['core', 'training'] });
    [emma, max, sofia, clara, tina, ian, arne] = await Promise.all(
      (['emma', 'max', 'sofia', 'clara', 'tina', 'ian', 'arne'] as const).map((p) => t.login(p)),
    );
    helen = await loginEmail(t, EMAILS.helen);
    victor = await loginEmail(t, EMAILS.victor);
    ids = {
      emma: await t.userId('emma'),
      max: await t.userId('max'),
      clara: await t.userId('clara'),
      arne: await t.userId('arne'),
      tina: await t.userId('tina'),
    };
  });

  afterAll(async () => {
    await t?.close();
  });

  const act = (auth: string, id: string, action: string, body: object = {}) =>
    t.http().post(`${API}/training/participations/${id}/actions/${action}`).set('Authorization', auth).send(body);
  const get = (auth: string, id: string) =>
    t.http().get(`${API}/training/participations/${id}`).set('Authorization', auth);
  const newRequest = async (auth: string, attendees: string[], overrides: Record<string, unknown> = {}) =>
    (
      await t
        .http()
        .post(`${API}/training/requests`)
        .set('Authorization', auth)
        .send(requestBody(attendees.map((userId) => ({ userId })), overrides))
        .expect(201)
    ).body as { id: string; attendees: { id: string; status: string }[] };
  const auditOf = (id: string) =>
    t.prisma.auditLog.findMany({ where: { entityId: id }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] });

  describe('manager step', () => {
    it('approver approves -> to_book, with decision, audit, notifications', async () => {
      const id = await attendeeId(t, 1); // S-T1 Emma -> Max
      const before = await get(max, id).expect(200);
      expect(before.body.availableActions).toEqual(['approve', 'decline']);
      const res = await act(max, id, 'approve', { comment: 'Good fit' }).expect(200);
      expect(res.body).toMatchObject({
        status: 'to_book',
        managerDecision: { actingAs: 'approver', by: { id: ids.max }, comment: 'Good fit', autoApproval: null },
        request: { reference: 'TRN-000001' },
      });
      const audit = await auditOf(id);
      expect(audit.at(-1)).toMatchObject({ action: 'approve', actingAs: 'approver', fromState: 'pending_manager_approval', toState: 'to_book' });
      const mails = (await t.prisma.emailMessage.findMany({ where: { entityId: id } })).map((m) => m.templateId);
      expect(mails).toEqual(expect.arrayContaining(['training.participation_approved', 'training.booking_requested']));
    });

    it('active deputy decides for the principal (Max for Priya, S-T8)', async () => {
      const id = await attendeeId(t, 8);
      const res = await act(max, id, 'approve').expect(200);
      expect(res.body.managerDecision).toMatchObject({ actingAs: 'deputy', by: { id: ids.max } });
      const audit = await auditOf(id);
      expect(audit.at(-1)).toMatchObject({ action: 'approve', actingAs: 'deputy' });
    });

    it('manager chain overrides a manager step (Max for the Eastgate lead\'s report)', async () => {
      const id = await attendeeId(t, 14);
      const list = await t
        .http()
        .get(`${API}/training/participations?scope=team&status=pending_manager_approval`)
        .set('Authorization', max)
        .expect(200);
      const row = list.body.data.find((r: { id: string }) => r.id === id);
      expect(row).toMatchObject({ actingAs: 'manager_chain', availableActions: ['approve', 'decline'] });
      const res = await act(max, id, 'decline', { reason: 'Please take the Eastgate session in spring.' }).expect(200);
      expect(res.body).toMatchObject({
        status: 'declined',
        declineReason: 'Please take the Eastgate session in spring.',
        managerDecision: { actingAs: 'manager_chain' },
      });
    });

    it('decline needs a reason of 3-1000 characters (422)', async () => {
      const id = await attendeeId(t, 7, 0);
      const res = await act(max, id, 'decline', { reason: 'no' }).expect(422);
      expect(Object.keys(res.body.errors)).toEqual(['reason']);
      await act(max, id, 'decline', {}).expect(422);
      await act(max, id, 'approve', { comment: 'ok', extra: true }).expect(422);
    });

    it('denies people without the right: 403 when visible, 404 when not', async () => {
      const id = await attendeeId(t, 7, 1); // Hillford technician, approver Max (escalated past Sofia)
      // Sofia (requester, skipped site manager) can see it but cannot decide.
      await act(sofia, id, 'approve').expect(403);
      // it_admin sees everything but never approves (D13).
      await act(ian, id, 'approve').expect(403);
      // Arne cannot see it at all.
      await act(arne, id, 'approve').expect(404);
      await get(arne, id).expect(404);
      // Unknown action and malformed id.
      await act(max, id, 'teleport').expect(404);
      await act(max, 'nope', 'approve').expect(404);
    });

    it('nobody approves their own participation', async () => {
      const created = await newRequest(max, [ids.max]);
      const id = created.attendees[0].id;
      const res = await get(max, id).expect(200);
      expect(res.body.availableActions).toEqual(['withdraw', 'edit_goals']);
      await act(max, id, 'approve').expect(403);
      const asClara = await get(clara, id).expect(200);
      expect(asClara.body.availableActions).toEqual(['approve', 'decline']);
    });

    it('past-start pending items can only be declined or withdrawn (#11)', async () => {
      const created = await newRequest(tina, [ids.emma], { startsOn: d(-1), endsOn: d(-1) });
      const id = created.attendees[0].id;
      const res = await get(max, id).expect(200);
      expect(res.body.availableActions).toEqual(['decline']);
      expect(res.body.isHighPriority).toBe(false);
      const conflict = await act(max, id, 'approve').expect(409);
      expect(conflict.body.code).toBe('invalid_transition');
      await act(emma, id, 'withdraw').expect(200);
    });
  });

  describe('executive step', () => {
    it('approval with an executive step moves to pending_executive_approval', async () => {
      const created = await newRequest(emma, [ids.emma], { cost: money(520000), executiveApproverId: ids.clara });
      const id = created.attendees[0].id;
      const res = await act(max, id, 'approve').expect(200);
      expect(res.body).toMatchObject({ status: 'pending_executive_approval', executiveDecision: null });
      const mails = (await t.prisma.emailMessage.findMany({ where: { entityId: id } })).map((m) => m.templateId);
      expect(mails).toContain('training.executive_approval_requested');
      // the manager chain cannot decide an executive step
      await act(sofia, id, 'approve').expect(404);
      await act(max, id, 'approve').expect(403);
      const final = await act(clara, id, 'approve', { comment: 'Approved for the leadership track' }).expect(200);
      expect(final.body).toMatchObject({
        status: 'to_book',
        executiveDecision: { actingAs: 'executive', by: { id: ids.clara }, comment: 'Approved for the leadership track' },
      });
    });

    it("the executive's deputy may decide the executive step (Helen for Clara, S-T9)", async () => {
      const id = await attendeeId(t, 9);
      const res = await act(helen, id, 'decline', { reason: 'Budget is frozen until next year.' }).expect(200);
      expect(res.body).toMatchObject({ status: 'declined', executiveDecision: { actingAs: 'deputy' } });
      // Victor (manager-step approver) no longer has a say.
      await act(victor, id, 'approve').expect(409);
    });

    it('executive approver deciding the manager step completes the executive step (same_approver)', async () => {
      const grace = await t.userId(EMAILS.grace);
      const graceAuth = await loginEmail(t, EMAILS.grace);
      const created = await newRequest(graceAuth, [grace], { cost: money(600000), executiveApproverId: ids.clara });
      const id = created.attendees[0].id;
      const res = await act(clara, id, 'approve').expect(200);
      expect(res.body).toMatchObject({
        status: 'to_book',
        managerDecision: { actingAs: 'approver' },
        executiveDecision: { autoApproval: 'same_approver', actingAs: 'system' },
      });
      const audit = await auditOf(id);
      expect(audit.slice(-2).map((a) => [a.action, a.reason])).toEqual([
        ['approve', null],
        ['auto_approve', 'same_approver'],
      ]);
    });
  });

  describe('withdraw', () => {
    it('owner withdraws while pending -> cancelled; the pending approver is notified', async () => {
      const id = await attendeeId(t, 12); // Grace -> Clara
      const graceAuth = await loginEmail(t, EMAILS.grace);
      const res = await act(graceAuth, id, 'withdraw', { reason: 'Moved to next year' }).expect(200);
      expect(res.body).toMatchObject({ status: 'cancelled', cancellationReason: 'Moved to next year' });
      expect(res.body.cancelledAt).not.toBeNull();
      const mail = await t.prisma.emailMessage.findFirstOrThrow({
        where: { entityId: id, templateId: 'training.participation_withdrawn' },
      });
      expect(mail.to).toEqual(['clara.ceo@example.com']);
    });

    it('requester and back office may withdraw pending rows; others may not', async () => {
      const { attendees } = await attendeesOf(t, 7);
      await act(emma, attendees[0].id, 'withdraw').expect(404);
      await act(max, attendees[0].id, 'withdraw').expect(403);
      await act(sofia, attendees[0].id, 'withdraw').expect(200);
      const created = await newRequest(emma, [ids.emma]);
      const res = await act(tina, created.attendees[0].id, 'withdraw').expect(200);
      expect(res.body.status).toBe('cancelled');
      const audit = await auditOf(created.attendees[0].id);
      expect(audit.at(-1)).toMatchObject({ action: 'withdraw', actingAs: 'back_office' });
    });

    it('withdraw is not available after approval (409)', async () => {
      const id = await attendeeId(t, 13); // to_book
      const res = await act(max, id, 'withdraw').expect(409);
      expect(res.body.code).toBe('invalid_transition');
    });
  });

  describe('booking', () => {
    it('book links documents, creates the loop-1 rating and notifies', async () => {
      const id = await attendeeId(t, 13); // S-T13 Max, to_book
      await act(max, id, 'book').expect(403);
      const upload = await t
        .http()
        .post(`${API}/attachments`)
        .set('Authorization', tina)
        .field('purpose', 'training_booking_document')
        .attach('file', Buffer.from('%PDF-1.4\n%%EOF\n', 'latin1'), 'booking.pdf')
        .expect(201);
      const res = await act(tina, id, 'book', {
        bookingReference: 'HTG-1',
        comment: 'Room 2',
        attachmentIds: [upload.body.id],
      }).expect(200);
      expect(res.body).toMatchObject({ status: 'booked', bookingReference: 'HTG-1' });
      expect(res.body.attachments.map((a: { id: string }) => a.id)).toEqual([upload.body.id]);
      expect(res.body.ratings).toEqual([expect.objectContaining({ loop: 1, state: 'upcoming', rater: expect.objectContaining({ id: ids.max }) })]);
      expect(res.body.availableActions).toEqual([]); // computed for the office
      const asMax = await get(max, id).expect(200);
      expect(asMax.body.availableActions).toEqual(['request_cancellation', 'edit_goals']);
      const audit = await auditOf(id);
      expect(audit.at(-1)).toMatchObject({ action: 'book', actingAs: 'back_office' });
    });

    it('book rejects attachments of the wrong purpose (422 attachmentIds.0)', async () => {
      const id = await attendeeId(t, 19, 0);
      const upload = await t
        .http()
        .post(`${API}/attachments`)
        .set('Authorization', tina)
        .field('purpose', 'training_document')
        .attach('file', Buffer.from('%PDF-1.4\n%%EOF\n', 'latin1'), 'x.pdf')
        .expect(201);
      const res = await act(tina, id, 'book', { attachmentIds: [upload.body.id] }).expect(422);
      expect(Object.keys(res.body.errors)).toEqual(['attachmentIds.0']);
    });

    it('booking impossible -> retry -> to_book; it_admin acts as admin', async () => {
      const id = await attendeeId(t, 20); // to_book d+25
      const res = await act(ian, id, 'mark_booking_impossible', { reason: 'Course cancelled by the provider' }).expect(200);
      expect(res.body).toMatchObject({ status: 'booking_impossible', bookingImpossibleReason: 'Course cancelled by the provider' });
      expect((await auditOf(id)).at(-1)).toMatchObject({ actingAs: 'admin' });
      const asTina = await get(tina, id).expect(200);
      expect(asTina.body.availableActions).toEqual(['retry_booking', 'close']);
      const retry = await act(tina, id, 'retry_booking', { comment: 'New date found' }).expect(200);
      expect(retry.body).toMatchObject({ status: 'to_book', bookingImpossibleReason: null });
    });

    it('booking_impossible is not a dead end: close (back office) and withdraw (requester) (#11)', async () => {
      const id = await attendeeId(t, 16); // S-T16
      const asOwnerView = await get(tina, id).expect(200);
      expect(asOwnerView.body.availableActions).toEqual(['retry_booking', 'close']);
      await act(tina, id, 'withdraw').expect(403);
      await act(tina, id, 'close', {}).expect(422);
      const res = await act(tina, id, 'close', { reason: 'No alternative date this year.' }).expect(200);
      expect(res.body).toMatchObject({ status: 'cancelled', cancellationReason: 'No alternative date this year.' });

      const created = await newRequest(emma, [ids.emma]);
      const own = created.attendees[0].id;
      await act(max, own, 'approve').expect(200);
      await act(tina, own, 'mark_booking_impossible', { reason: 'Fully booked' }).expect(200);
      const ownView = await get(emma, own).expect(200);
      expect(ownView.body.availableActions).toEqual(['withdraw']);
      await act(emma, own, 'withdraw').expect(200);
    });

    it('retry is refused for trainings that already started (409)', async () => {
      const created = await newRequest(tina, [ids.arne], { startsOn: d(0), endsOn: d(1) });
      const id = created.attendees[0].id;
      await t.prisma.trainingAttendee.update({ where: { id }, data: { status: 'booking_impossible' } });
      await t.prisma.trainingRequest.update({ where: { id: created.id }, data: { startsOn: new Date(`${d(-1)}T00:00:00.000Z`) } });
      const res = await act(tina, id, 'retry_booking').expect(409);
      expect(res.body.code).toBe('invalid_transition');
    });
  });

  describe('cancellation', () => {
    it('request (owner) -> confirm (office) deletes the open loop-1 rating', async () => {
      const id = await attendeeId(t, 2); // S-T2 Emma booked, d+6
      await act(max, id, 'request_cancellation', { reason: 'Team needs her' }).expect(403);
      const req = await act(emma, id, 'request_cancellation', { reason: 'Clashes with the Westbay rollout.' }).expect(200);
      expect(req.body).toMatchObject({ status: 'cancellation_requested', cancellationReason: 'Clashes with the Westbay rollout.' });
      const mail = await t.prisma.emailMessage.findFirstOrThrow({ where: { entityId: id, templateId: 'training.cancellation_requested' } });
      expect(mail.to).toEqual(['training-office@example.com']);
      expect(await t.prisma.trainingRating.count({ where: { attendeeId: id } })).toBe(1);
      const res = await act(tina, id, 'confirm_cancellation', { comment: 'Fee refunded' }).expect(200);
      expect(res.body.status).toBe('cancelled');
      expect(await t.prisma.trainingRating.count({ where: { attendeeId: id } })).toBe(0);
    });

    it('reject restores the previous state (booked or to_book)', async () => {
      const booked = await attendeeId(t, 15, 1); // hilTech4: cancellation requested from booked
      const r1 = await act(tina, booked, 'reject_cancellation', { reason: 'Non-refundable at this point.' }).expect(200);
      expect(r1.body).toMatchObject({ status: 'booked', cancellationRequestedAt: null });
      const toBook = await attendeeId(t, 18, 1); // sdkAgent2: from to_book
      await act(emma, toBook, 'reject_cancellation', { reason: 'nope nope' }).expect(404);
      const r2 = await act(tina, toBook, 'reject_cancellation', { reason: 'Please swap shifts instead.' }).expect(200);
      expect(r2.body.status).toBe('to_book');
      const mails = (await t.prisma.emailMessage.findMany({ where: { entityId: toBook } })).map((m) => m.templateId);
      expect(mails).toContain('training.cancellation_rejected');
    });

    it('the requester may request cancellation; not after the training ended (409)', async () => {
      const id = await attendeeId(t, 21, 1); // sdkAgent8 booked, requested by Priya
      const priya = await loginEmail(t, EMAILS.priya);
      const res = await act(priya, id, 'request_cancellation', { reason: 'Agent changes teams.' }).expect(200);
      expect((await auditOf(id)).at(-1)).toMatchObject({ actingAs: 'requester' });
      expect(res.body.status).toBe('cancellation_requested');
      const ended = await attendeeId(t, 3); // S-T3 ended d-3
      const conflict = await act(emma, ended, 'request_cancellation', { reason: 'Too late now.' }).expect(409);
      expect(conflict.body.code).toBe('invalid_transition');
    });
  });

  describe('goals', () => {
    it('the attendee sets goals until the start; others cannot', async () => {
      const id = await attendeeId(t, 17); // Helen booked d+12
      const res = await t
        .http()
        .put(`${API}/training/participations/${id}/goals`)
        .set('Authorization', helen)
        .send({ goal1: 'Align the planning calendar', goal2: null })
        .expect(200);
      expect(res.body.goals).toMatchObject({ goal1: 'Align the planning calendar', goal2: null });
      expect(res.body.goals.updatedAt).not.toBeNull();
      await t
        .http()
        .put(`${API}/training/participations/${id}/goals`)
        .set('Authorization', tina)
        .send({ goal1: 'x', goal2: null })
        .expect(403);
      const ended = await attendeeId(t, 3);
      await t
        .http()
        .put(`${API}/training/participations/${ended}/goals`)
        .set('Authorization', emma)
        .send({ goal1: 'Too late', goal2: null })
        .expect(409);
      await t
        .http()
        .put(`${API}/training/participations/${id}/goals`)
        .set('Authorization', helen)
        .send({ goal1: 'x'.repeat(501), goal2: null })
        .expect(422);
    });
  });

  describe('lists and detail', () => {
    it('scopes: approvals, executive, deputy exclude the viewer (#13); all needs the office', async () => {
      const list = (auth: string, query: string) =>
        t.http().get(`${API}/training/participations?${query}`).set('Authorization', auth);
      const executive = await list(clara, 'scope=executive').expect(200);
      expect(executive.body.data.every((r: { actingAs: string; status: string }) => r.actingAs === 'executive' && r.status === 'pending_executive_approval')).toBe(true);
      const deputy = await list(helen, 'scope=deputy').expect(200);
      expect(deputy.body.data.every((r: { actingAs: string }) => r.actingAs === 'deputy')).toBe(true);
      const mine = await list(emma, 'scope=mine&perPage=100').expect(200);
      expect(mine.body.data.every((r: { user: { id: string } }) => r.user.id === ids.emma)).toBe(true);
      const withRating = mine.body.data.find((r: { request: { reference: string } }) => r.request.reference === 'TRN-000004');
      expect(withRating).toMatchObject({ goalsSet: true, openRating: { loop: 2, state: 'due' } });
      await list(emma, 'scope=all').expect(403);
      const all = await list(tina, 'scope=all&highPriority=true').expect(200);
      expect(all.body.data.every((r: { isHighPriority: boolean }) => r.isHighPriority)).toBe(true);
      await list(tina, 'scope=all&status=nope').expect(422);
      await list(tina, 'scope=all&sort=bogus').expect(422);
    });

    it('participation timeline hides loop-3 entries from the attendee', async () => {
      const id = await attendeeId(t, 26, 0); // sdkLead, loop 3 with reminders
      const lead = (await attendeesOf(t, 26)).attendees[0];
      const office = await t.http().get(`${API}/training/participations/${id}/timeline`).set('Authorization', tina).expect(200);
      expect(office.body.some((e: { entityLabel: string }) => e.entityLabel === 'Feedback round 3')).toBe(true);
      const leadAuth = await loginEmail(t, lead.user.email);
      const own = await t.http().get(`${API}/training/participations/${id}/timeline`).set('Authorization', leadAuth).expect(200);
      expect(own.body.some((e: { entityLabel: string }) => e.entityLabel === 'Feedback round 3')).toBe(false);
    });

    it('CSV export for the office only, with BOM and decimal euros', async () => {
      await t.http().get(`${API}/training/participations/export.csv`).set('Authorization', emma).expect(403);
      const res = await t
        .http()
        .get(`${API}/training/participations/export.csv?status=booked`)
        .set('Authorization', tina)
        .expect(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text.charCodeAt(0)).toBe(0xfeff);
      const lines = res.text.trim().split('\r\n');
      expect(lines[0]).toContain('reference,topic,provider');
      expect(lines.slice(1).every((l) => l.includes(',Booked,'))).toBe(true);
      expect(res.text).toMatch(/,3200\.00,/);
    });
  });
});
