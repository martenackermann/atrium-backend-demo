import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { JobRunContext } from '@/modules/core/jobs/scheduled-job.decorator';
import type { AuthUser } from '@/common/auth/auth-user';
import { TravelJobs } from '@/modules/travel/jobs/travel.jobs';
import { TravelMyDayContributor } from '@/modules/travel/services/travel-providers';
import { demoBookingPdf } from '@/modules/travel/seed/demo-pdf';
import { createTestApp, type TestApp } from '../support/test-app';

/**
 * Travel desk side (slice A2): booking with confirmations + encrypted PIN, booking impossible,
 * cancellations, car classes, queue counts, inbox/search/my-day providers, export, digest job.
 */
describe('travel desk', () => {
  let t: TestApp;
  const auth: Record<string, string> = {};

  const requestId = async (number: number) =>
    (await t.prisma.travelRequest.findUniqueOrThrow({ where: { number } })).id;
  const act = (who: string, id: string, action: string, body: object = {}) =>
    t.http().post(`/api/v1/travel/requests/${id}/actions/${action}`).set('Authorization', auth[who]).send(body);
  const get = (who: string, path: string) => t.http().get(`/api/v1${path}`).set('Authorization', auth[who]);
  const upload = (who: string, purpose = 'travel_booking_confirmation', content = demoBookingPdf('Test', ['x'])) =>
    t
      .http()
      .post('/api/v1/attachments')
      .set('Authorization', auth[who])
      .field('purpose', purpose)
      .attach('file', content, { filename: 'confirmation.pdf', contentType: 'application/pdf' });

  beforeAll(async () => {
    t = await createTestApp({ seed: ['core', 'travel'] });
    for (const p of ['emma', 'max', 'sofia', 'clara', 'tom', 'arne', 'ian'] as const) auth[p] = await t.login(p);
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('booking (D12)', () => {
    it('Tom books S-V13 with a PDF and a PIN; the email carries the PDF but never the PIN', async () => {
      const id = await requestId(13);
      const file = (await upload('tom').expect(201)).body as { id: string };
      expect((await act('tom', id, 'book', { bookingNumber: 'AB12CD' }).expect(422)).body.errors).toHaveProperty(
        'attachmentIds',
      );
      expect(
        (await act('tom', id, 'book', { bookingNumber: 'AB12CD', pin: '12', attachmentIds: [file.id] }).expect(422))
          .body.errors,
      ).toHaveProperty('pin');
      const res = await act('tom', id, 'book', {
        bookingNumber: 'AB12CD',
        pin: '7731',
        comment: 'Pick up at desk 3.',
        attachmentIds: [file.id],
      }).expect(200);
      expect(res.body).toMatchObject({
        status: 'booked',
        booking: {
          bookingNumber: 'AB12CD',
          pinAvailable: true,
          comment: 'Pick up at desk 3.',
          bookedBy: expect.objectContaining({ displayName: 'Tom Travel-Desk' }),
          attachments: [expect.objectContaining({ id: file.id, purpose: 'travel_booking_confirmation' })],
        },
        availableActions: ['view_pin'],
      });
      const stored = await t.prisma.travelBooking.findUniqueOrThrow({ where: { requestId: id } });
      expect(stored.pinEncrypted).not.toContain('7731');
      const mail = await t.prisma.emailMessage.findFirstOrThrow({
        where: { entityId: id, templateId: 'travel.booked' },
      });
      expect(mail.attachmentIds).toEqual([file.id]);
      expect(JSON.stringify(mail.payload)).not.toContain('7731');
      expect(mail.subject).toBe('Booked: car Riverton → Oakridge');
    });

    it('only the desk may upload confirmations and book', async () => {
      expect((await upload('emma').expect(403)).body.code).toBe('forbidden');
      const id = await requestId(2);
      expect((await act('emma', id, 'book', { bookingNumber: 'X', attachmentIds: [] }).expect(403)).body.code).toBe(
        'forbidden',
      );
      const emma = await get('emma', `/travel/requests/${id}`).expect(200);
      expect(emma.body.availableActions).toEqual(['request_cancellation']);
      const tom = await get('tom', `/travel/requests/${id}`).expect(200);
      expect(tom.body.availableActions).toEqual(['book', 'mark_booking_impossible']);
    });

    it('confirmation PDFs are downloadable for viewers only', async () => {
      const sv3 = await get('emma', `/travel/requests/${await requestId(3)}`).expect(200);
      const attachmentId = sv3.body.booking.attachments[0].id as string;
      expect(sv3.body.booking.attachments[0].originalName).toBe('booking-confirmation-QX7H2L.pdf');
      const url = await get('emma', `/attachments/${attachmentId}/download-url`).expect(200);
      expect(url.body.url).toContain('/api/v1/files/');
      await get('arne', `/attachments/${attachmentId}/download-url`).expect(404);
    });
  });

  describe('PIN reveal (SPEC_RESOLUTIONS #24)', () => {
    it('traveller and desk see the PIN (audited view_pin); approver and it_admin do not', async () => {
      const id = await requestId(3);
      expect((await get('emma', `/travel/requests/${id}/booking/pin`).expect(200)).body).toEqual({ pin: '4821' });
      expect((await get('tom', `/travel/requests/${id}/booking/pin`).expect(200)).body).toEqual({ pin: '4821' });
      expect((await get('max', `/travel/requests/${id}/booking/pin`).expect(403)).body.code).toBe('forbidden');
      expect((await get('ian', `/travel/requests/${id}/booking/pin`).expect(403)).body.code).toBe('forbidden');
      await get('arne', `/travel/requests/${id}/booking/pin`).expect(404);
      const ian = await get('ian', `/travel/requests/${id}`).expect(200);
      expect(ian.body.availableActions).not.toContain('view_pin');
      const audits = await t.prisma.auditLog.findMany({ where: { entityId: id, action: 'view_pin' } });
      expect(audits.map((a) => a.actingAs).sort()).toEqual(['back_office', 'self']);
    });

    it('404 when the booking has no PIN', async () => {
      await get('emma', `/travel/requests/${await requestId(4)}/booking/pin`).expect(404);
    });
  });

  describe('booking impossible (SPEC_RESOLUTIONS #11)', () => {
    it('mark impossible -> retry -> to_book; close -> cancelled', async () => {
      const id = await requestId(34);
      const retry = await act('tom', id, 'retry_booking', { comment: 'Vans available again' }).expect(200);
      expect(retry.body).toMatchObject({ status: 'to_book', bookingImpossibleReason: null });
      expect((await act('tom', id, 'mark_booking_impossible', {}).expect(422)).body.errors).toHaveProperty('reason');
      const impossible = await act('tom', id, 'mark_booking_impossible', { reason: 'Still no vans.' }).expect(200);
      expect(impossible.body).toMatchObject({
        status: 'booking_impossible',
        bookingImpossibleReason: 'Still no vans.',
      });
      expect(impossible.body.availableActions).toEqual(['retry_booking', 'close']);
      const mail = await t.prisma.emailMessage.findFirstOrThrow({
        where: { entityId: id, templateId: 'travel.booking_impossible' },
      });
      expect(mail.subject).toBe('Booking not possible: Hillford → Riverton');
      const closed = await act('tom', id, 'close', { reason: 'Trip no longer needed.' }).expect(200);
      expect(closed.body).toMatchObject({ status: 'cancelled', cancellationReason: 'Trip no longer needed.' });
    });

    it('the traveller may withdraw a booking-impossible trip; the desk may not', async () => {
      const id = await requestId(35);
      const row = await t.prisma.travelRequest.findUniqueOrThrow({ where: { id }, include: { traveller: true } });
      expect(row.status).toBe('booking_impossible');
      expect((await act('tom', id, 'withdraw').expect(403)).body.code).toBe('forbidden');
      const login = await t
        .http()
        .post('/api/v1/auth/login')
        .send({ email: row.traveller.email, password: 'demo1234' })
        .expect(200);
      auth.ppl4 = `Bearer ${login.body.accessToken as string}`;
      const before = await get('ppl4', `/travel/requests/${id}`).expect(200);
      expect(before.body.availableActions).toEqual(['withdraw']);
      const res = await act('ppl4', id, 'withdraw', { reason: 'I will take the car instead.' }).expect(200);
      expect(res.body.status).toBe('cancelled');
    });
  });

  describe('cancellation (D10)', () => {
    it('request -> reject restores booked -> request -> confirm', async () => {
      const id = await requestId(3);
      expect((await act('emma', id, 'request_cancellation', {}).expect(422)).body.errors).toHaveProperty('reason');
      const requested = await act('emma', id, 'request_cancellation', { reason: 'Meeting moved online.' }).expect(200);
      expect(requested.body).toMatchObject({
        status: 'cancellation_requested',
        cancellationReason: 'Meeting moved online.',
      });
      const mail = await t.prisma.emailMessage.findFirstOrThrow({
        where: { entityId: id, templateId: 'travel.cancellation_requested' },
      });
      expect(mail).toMatchObject({ to: ['travel-desk@example.com'], cc: ['emma.employee@example.com'] });
      expect((await act('emma', id, 'confirm_cancellation').expect(403)).body.code).toBe('forbidden');
      const rejected = await act('tom', id, 'reject_cancellation', { reason: 'Non-refundable fare.' }).expect(200);
      expect(rejected.body).toMatchObject({ status: 'booked', cancellationRequestedAt: null });
      await act('emma', id, 'request_cancellation', { reason: 'Meeting cancelled for good.' }).expect(200);
      const confirmed = await act('tom', id, 'confirm_cancellation', { comment: 'Refund requested.' }).expect(200);
      expect(confirmed.body).toMatchObject({ status: 'cancelled', availableActions: [] });
      expect(confirmed.body.cancelledAt).not.toBeNull();
    });

    it('reject restores to_book for a request cancelled before booking', async () => {
      const id = await requestId(36);
      const res = await act('tom', id, 'reject_cancellation', { reason: 'Customer confirmed again.' }).expect(200);
      expect(res.body.status).toBe('to_book');
    });

    it('a finished trip cannot be cancelled (409)', async () => {
      expect(
        (await act('emma', await requestId(4), 'request_cancellation', { reason: 'Too late' }).expect(409)).body.code,
      ).toBe('invalid_transition');
    });
  });

  describe('car classes', () => {
    it('lists active classes for everyone, inactive only for the desk', async () => {
      const emma = await get('emma', '/travel/car-classes?includeInactive=true').expect(200);
      expect(emma.body.map((c: { code: string }) => c.code)).toEqual([
        'ECMR',
        'CDMR',
        'IDAR',
        'SWMR',
        'PDAR',
        'XVMR',
        'LVMR',
      ]);
      const vans = await get('emma', '/travel/car-classes?vehicleType=van').expect(200);
      expect(vans.body).toEqual([
        expect.objectContaining({ code: 'XVMR', isDefault: true }),
        expect.objectContaining({ code: 'LVMR', isDefault: false }),
      ]);
    });

    it('desk CRUD: create, conflict, make standard, guard the only default', async () => {
      const body = { code: 'fdar', name: 'Full-size automatic', vehicleType: 'car', sortOrder: 60 };
      expect(
        (await t.http().post('/api/v1/travel/car-classes').set('Authorization', auth.emma).send(body).expect(403)).body
          .code,
      ).toBe('forbidden');
      const created = await t
        .http()
        .post('/api/v1/travel/car-classes')
        .set('Authorization', auth.tom)
        .send(body)
        .expect(201);
      expect(created.body).toMatchObject({ code: 'FDAR', isDefault: false, active: true, description: null });
      expect(
        (await t.http().post('/api/v1/travel/car-classes').set('Authorization', auth.tom).send(body).expect(409)).body
          .code,
      ).toBe('conflict');
      await t
        .http()
        .post('/api/v1/travel/car-classes')
        .set('Authorization', auth.tom)
        .send({ ...body, code: 'TOOLONG' })
        .expect(422);

      const patch = (id: string, b: object) =>
        t.http().patch(`/api/v1/travel/car-classes/${id}`).set('Authorization', auth.tom).send(b);
      const made = await patch(created.body.id, { isDefault: true }).expect(200);
      expect(made.body.isDefault).toBe(true);
      const ecmr = await t.prisma.carRentalClass.findUniqueOrThrow({ where: { code: 'ECMR' } });
      expect(ecmr.isDefault).toBe(false);
      expect((await patch(created.body.id, { isDefault: false }).expect(422)).body.errors).toHaveProperty('isDefault');
      expect((await patch(created.body.id, { active: false }).expect(422)).body.errors).toHaveProperty('active');
      // restore the seeded standard and deactivate the new class
      await patch(ecmr.id, { isDefault: true }).expect(200);
      await patch(created.body.id, { active: false }).expect(200);
      const desk = await get('tom', '/travel/car-classes?includeInactive=true&vehicleType=car').expect(200);
      expect(desk.body.find((c: { code: string }) => c.code === 'FDAR')).toMatchObject({ active: false });
      const emma = await get('emma', '/travel/car-classes?vehicleType=car').expect(200);
      expect(emma.body.map((c: { code: string }) => c.code)).not.toContain('FDAR');
      const audit = await t.prisma.auditLog.findMany({
        where: { entityType: 'car_rental_class', entityId: created.body.id },
      });
      expect(audit.map((a) => a.action)).toEqual(['create', 'update', 'update', 'update']);
    });
  });

  describe('queues, inbox, search, my day', () => {
    it('counts per persona', async () => {
      const emma = await get('emma', '/travel/queues/counts').expect(200);
      expect(emma.body).toMatchObject({ approvals: { mine: 0, deputy: 0, team: 0 }, desk: null });
      expect(emma.body.mine.active).toBeGreaterThanOrEqual(3);
      const max = await get('max', '/travel/queues/counts').expect(200);
      expect(max.body.approvals).toEqual({ mine: 4, deputy: 1, team: 1 });
      const tom = await get('tom', '/travel/queues/counts').expect(200);
      expect(tom.body.desk).toMatchObject({ pendingApproval: 8, bookingImpossible: expect.any(Number) });
      expect((await get('ian', '/travel/queues/counts').expect(200)).body.desk).not.toBeNull();
    });

    it('inbox: approvals for Max (incl. deputy), desk items for Tom, none for it_admin', async () => {
      const max = await get('max', '/me/inbox?module=travel').expect(200);
      const types = max.body.data.map((i: { type: string }) => i.type);
      expect(types.every((x: string) => x === 'travel.approval_required')).toBe(true);
      const deputyItem = max.body.data.find((i: { actingAs: string }) => i.actingAs === 'deputy');
      expect(deputyItem).toMatchObject({
        subtitle: expect.stringContaining('for Priya Raman'),
        quickActions: ['approve', 'decline'],
        actionsPath: expect.stringMatching(/^\/travel\/requests\//),
        link: expect.stringContaining('/travel/approvals?tab=deputy&selected='),
      });
      const tom = await get('tom', '/me/inbox?module=travel').expect(200);
      const tomTypes = new Set(tom.body.data.map((i: { type: string }) => i.type));
      expect(tomTypes).toEqual(new Set(['travel.booking_required', 'travel.cancellation_review']));
      expect(tom.body.data[0].priority).toBe('high');
      const ian = await get('ian', '/me/inbox?module=travel').expect(200);
      expect(ian.body.data).toEqual([]);
      const emma = await get('emma', '/me/inbox?module=travel').expect(200);
      expect(emma.body.data).toEqual([]);
    });

    it('search is permission-filtered and matches references exactly', async () => {
      const emma = await get('emma', '/search?q=TRV-000006').expect(200);
      expect(emma.body.data).toContainEqual(expect.objectContaining({ module: 'travel', reference: 'TRV-000006' }));
      const arne = await get('arne', '/search?q=TRV-000006').expect(200);
      expect(arne.body.data.filter((h: { module: string }) => h.module === 'travel')).toEqual([]);
      const route = await get('emma', '/search?q=westbay').expect(200);
      expect(route.body.data.filter((h: { module: string }) => h.module === 'travel').length).toBeGreaterThanOrEqual(1);
    });

    it('my-day upcoming: my trips (traveller or companion) in the next 30 days', async () => {
      const emmaUser: AuthUser = {
        id: await t.userId('emma'),
        email: 'emma.employee@example.com',
        displayName: 'Emma Employee',
        roles: ['employee'],
        isSiteManager: false,
        sessionId: null,
      };
      const fragment = await t.app.get(TravelMyDayContributor).contribute(emmaUser);
      const titles = fragment.upcoming!.map((u) => u.title);
      expect(titles).toContain('Riverton Central → Hillford Central');
      expect(titles).toContain('Riverton Central → Highmoor Central'); // as companion
      expect(fragment.upcoming!.every((u) => u.module === 'travel')).toBe(true);
    });
  });

  describe('export, digest, meta', () => {
    it('CSV export for the desk only', async () => {
      await get('emma', '/travel/requests/export.csv').expect(403);
      const res = await get('tom', '/travel/requests/export.csv?kind=flight').expect(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toMatch(
        /attachment; filename="travel-requests-\d{4}-\d{2}-\d{2}\.csv"/,
      );
      expect(res.text.charCodeAt(0)).toBe(0xfeff);
      const lines = res.text.trim().split('\r\n');
      expect(lines[0]).toContain('Reference,Kind,Status');
      expect(lines.slice(1).every((l) => l.includes(',Flight,'))).toBe(true);
    });

    it('high-priority digest emails the desk mailbox', async () => {
      const ctx: JobRunContext = {
        runId: 'test',
        triggeredBy: 'manual',
        triggeredById: null,
        now: new Date(),
        today: '',
      };
      const summary = await t.app.get(TravelJobs).highPriorityDigest(ctx);
      expect(summary.highPriority).toBeGreaterThanOrEqual(2);
      const mail = await t.prisma.emailMessage.findFirstOrThrow({
        where: { templateId: 'travel.high_priority_digest' },
      });
      expect(mail).toMatchObject({ to: ['travel-desk@example.com'], priority: 'high' });
      expect(mail.subject).toMatch(/^\[High priority\] \d+ high-priority travel requests?$/);
    });

    it('serves travel enums and the workflow diagram', async () => {
      const enums = await get('emma', '/meta/enums').expect(200);
      expect(enums.body.travelStatus).toContainEqual({
        value: 'to_book',
        label: 'To book',
        tone: 'moving',
        description: null,
      });
      expect(enums.body.approvalReason).toContainEqual(
        expect.objectContaining({ value: 'train_saver_fare', label: 'Saver fare (non-refundable)' }),
      );
      const wf = await get('emma', '/meta/workflows/travel_request').expect(200);
      expect(wf.body.initialStates).toEqual(['pending_approval', 'to_book']);
      expect(wf.body.transitions.length).toBeGreaterThanOrEqual(12);
    });
  });
});
