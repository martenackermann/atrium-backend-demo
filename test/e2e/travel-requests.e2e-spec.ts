import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../support/test-app';

/**
 * Travel requests (slice A2): preview, create (all kinds), validation, visibility,
 * scopes and the approval part of the lifecycle (SPEC §3.2, §5.2, §6.3; API.md §5).
 */
const DAY = 86_400_000;
const iso = (offsetDays: number, hour = 8) => {
  const d = new Date(Date.now() + offsetDays * DAY);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

const equipment = (overrides: Record<string, boolean> = {}) => ({
  estate: false,
  navigation: false,
  automaticPreferred: false,
  automaticRequired: false,
  diesel: false,
  winterTyres: false,
  foreignTravel: false,
  childSeat: false,
  ...overrides,
});

describe('travel requests', () => {
  let t: TestApp;
  const auth: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let ecmr: string;
  let idar: string;
  let xvmr: string;

  const requestId = async (number: number) =>
    (await t.prisma.travelRequest.findUniqueOrThrow({ where: { number } })).id;

  const carBody = (
    travellerId: string,
    overrides: Record<string, unknown> = {},
    car: Record<string, unknown> = {},
  ) => ({
    kind: 'car',
    travellerId,
    car: {
      vehicleType: 'car',
      carClassId: ecmr,
      pickupAt: iso(10),
      returnAt: iso(11, 17),
      destination: 'Lakeside',
      equipment: equipment(),
      handover: { mode: 'branch', branch: 'Riverton' },
      dropOff: { mode: 'branch', branch: 'Riverton' },
      driver: {
        firstName: 'Emma',
        lastName: 'Employee',
        email: 'emma.employee@example.com',
        phone: '555-0107',
        birthDate: '1990-04-02',
      },
      ...car,
    },
    ...overrides,
  });

  const trainBody = (travellerId: string, train: Record<string, unknown> = {}) => ({
    kind: 'train',
    travellerId,
    train: {
      tripType: 'return',
      outboundAt: iso(12, 6),
      returnAt: iso(12, 17),
      fromStation: 'Riverton Central',
      toStation: 'Hillford Central',
      fareType: 'flex',
      seatReservations: 1,
      separateTickets: false,
      localTransportTicket: false,
      ...train,
    },
  });

  const flightBody = (travellerId: string, flight: Record<string, unknown> = {}) => ({
    kind: 'flight',
    travellerId,
    flight: {
      tripType: 'return',
      outboundDepartureAt: iso(20, 6),
      outboundFrom: 'Riverton Airport',
      outboundTo: 'Northport Airport',
      returnDepartureAt: iso(22, 16),
      returnFrom: 'Northport Airport',
      returnTo: 'Riverton Airport',
      handLuggageOnly: true,
      ...flight,
    },
  });

  const create = (who: string, body: object) =>
    t.http().post('/api/v1/travel/requests').set('Authorization', auth[who]).send(body);
  const act = (who: string, id: string, action: string, body: object = {}) =>
    t.http().post(`/api/v1/travel/requests/${id}/actions/${action}`).set('Authorization', auth[who]).send(body);
  const get = (who: string, path: string) => t.http().get(`/api/v1${path}`).set('Authorization', auth[who]);

  beforeAll(async () => {
    t = await createTestApp({ seed: ['core', 'travel'] });
    for (const p of ['emma', 'max', 'sofia', 'clara', 'tom', 'arne', 'ian'] as const) auth[p] = await t.login(p);
    for (const p of ['emma', 'max', 'sofia', 'clara', 'tom']) ids[p] = await t.userId(p);
    ids.sdkAgent = (
      await t.prisma.user.findFirstOrThrow({ where: { jobTitle: 'Service Desk Agent', active: true } })
    ).id;
    const classes = await t.prisma.carRentalClass.findMany();
    ecmr = classes.find((c) => c.code === 'ECMR')!.id;
    idar = classes.find((c) => c.code === 'IDAR')!.id;
    xvmr = classes.find((c) => c.code === 'XVMR')!.id;
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('seeded story records', () => {
    it("lists Emma's trips with references, reasons and actions (scope mine)", async () => {
      const res = await get('emma', '/travel/requests?perPage=50').expect(200);
      const byRef = Object.fromEntries(res.body.data.map((r: { reference: string }) => [r.reference, r]));
      expect(byRef['TRV-000001']).toMatchObject({
        kind: 'car',
        status: 'pending_approval',
        route: 'Riverton → Westbay',
        needsApproval: true,
        approvalReasons: [
          { code: 'car_automatic_required', label: 'Automatic transmission (guaranteed)' },
          { code: 'car_foreign_travel', label: 'Foreign travel' },
        ],
        approver: expect.objectContaining({ displayName: 'Max Manager' }),
        approverReason: 'direct_manager',
        availableActions: ['withdraw'],
        actingAs: null,
      });
      expect(byRef['TRV-000002']).toMatchObject({ status: 'to_book', isHighPriority: true, needsApproval: false });
      expect(byRef['TRV-000003'].availableActions).toEqual(['request_cancellation', 'view_pin']);
      expect(byRef['TRV-000004'].availableActions).toEqual([]); // past trip: cancellation no longer possible
      expect(byRef['TRV-000029']).toBeDefined(); // Emma travels as a companion
      expect(Object.keys(byRef)).not.toContain('TRV-000007');
    });

    it('S-V8 is escalated past the site manager to Max', async () => {
      const res = await get('max', `/travel/requests/${await requestId(8)}`).expect(200);
      expect(res.body).toMatchObject({
        approverReason: 'site_manager_escalation',
        escalatedFrom: expect.objectContaining({ displayName: 'Sofia Site-Manager' }),
        approvalReasons: [{ code: 'car_delivery', label: 'Delivery to an address' }],
        availableActions: ['approve', 'decline'],
        actingAs: 'approver',
      });
      expect(res.body.car.handover.address).toMatchObject({ city: 'Hillford', countryCode: 'DE' });
    });

    it('S-V10 is exempt (executive traveller) and S-V7 was approved by Max', async () => {
      const clara = await get('clara', `/travel/requests/${await requestId(10)}`).expect(200);
      expect(clara.body).toMatchObject({
        status: 'to_book',
        needsApproval: false,
        approvalReasons: [],
        approvalExemption: { code: 'executive_traveller', label: 'Executive travellers approve their own trips' },
        approval: null,
      });
      const sofia = await get('sofia', `/travel/requests/${await requestId(7)}`).expect(200);
      expect(sofia.body.approval).toMatchObject({
        by: expect.objectContaining({ displayName: 'Max Manager' }),
        actingAs: 'approver',
        autoApproval: null,
      });
    });

    it('S-V6 shows the decline decision', async () => {
      const res = await get('emma', `/travel/requests/${await requestId(6)}`).expect(200);
      expect(res.body).toMatchObject({
        status: 'declined',
        declineReason: 'Standard class is sufficient for this trip.',
        approval: expect.objectContaining({ by: expect.objectContaining({ displayName: 'Max Manager' }) }),
        approvalReasons: [{ code: 'vehicle_class_upgrade', label: 'Vehicle class above standard' }],
      });
    });
  });

  describe('visibility (SPEC §3.2, D5)', () => {
    it("hides other people's trips with 404 and filters lists", async () => {
      const sv1 = await requestId(1);
      expect((await get('arne', `/travel/requests/${sv1}`).expect(404)).body.code).toBe('not_found');
      expect((await act('arne', sv1, 'withdraw').expect(404)).body.code).toBe('not_found');
      await get('arne', `/travel/requests/${sv1}/timeline`).expect(404);
      await get('arne', '/travel/requests/not-a-uuid').expect(404);
      const arne = await get('arne', '/travel/requests?scope=mine').expect(200);
      expect(arne.body.data.map((r: { reference: string }) => r.reference)).not.toContain('TRV-000001');
    });

    it('chain, approver, desk and it_admin can view; driver data per SPEC §3.2', async () => {
      const sv1 = await requestId(1);
      expect((await get('emma', `/travel/requests/${sv1}`).expect(200)).body.car.driver).not.toBeNull();
      expect((await get('max', `/travel/requests/${sv1}`).expect(200)).body.car.driver).not.toBeNull();
      expect((await get('tom', `/travel/requests/${sv1}`).expect(200)).body.car.driver).not.toBeNull();
      expect((await get('ian', `/travel/requests/${sv1}`).expect(200)).body.car.driver).not.toBeNull();
      // Clara is above Emma in the chain: read-only, no driver data
      const clara = await get('clara', `/travel/requests/${sv1}`).expect(200);
      expect(clara.body.car.driver).toBeNull();
      expect(clara.body.availableActions).toEqual(['approve', 'decline']); // manager-chain override (D9)
      // Sofia sees her Hillford technician's request (chain)
      await get('sofia', `/travel/requests/${await requestId(8)}`).expect(200);
    });

    it('it_admin sees everything but never decides approvals (D13)', async () => {
      const sv9 = await requestId(9);
      const res = await get('ian', `/travel/requests/${sv9}`).expect(200);
      expect(res.body.availableActions).toEqual([]);
      expect((await act('ian', sv9, 'approve').expect(403)).body.code).toBe('forbidden');
    });
  });

  describe('scopes (SPEC_RESOLUTIONS #13, #18)', () => {
    it('approvals, deputy and team for Max', async () => {
      const approvals = await get('max', '/travel/requests?scope=approvals').expect(200);
      expect(approvals.body.data.map((r: { reference: string }) => r.reference).sort()).toEqual(
        ['TRV-000001', 'TRV-000008', 'TRV-000009', 'TRV-000015'].sort(),
      );
      expect(approvals.body.data[0].startsAt <= approvals.body.data[1].startsAt).toBe(true); // default sort startsAt
      const deputy = await get('max', '/travel/requests?scope=deputy').expect(200);
      expect(deputy.body.data).toEqual([
        expect.objectContaining({
          reference: 'TRV-000011',
          actingAs: 'deputy',
          availableActions: ['approve', 'decline'],
        }),
      ]);
      const team = await get('max', '/travel/requests?scope=team&status=pending_approval&perPage=50').expect(200);
      expect(team.body.data).toContainEqual(
        expect.objectContaining({
          reference: 'TRV-000014',
          actingAs: 'manager_chain',
          availableActions: ['approve', 'decline'],
        }),
      );
    });

    it('scope=all is for the desk and it_admin only', async () => {
      expect((await get('emma', '/travel/requests?scope=all').expect(403)).body.code).toBe('forbidden');
      const tom = await get('tom', '/travel/requests?scope=all&perPage=100').expect(200);
      expect(tom.body.meta.total).toBeGreaterThanOrEqual(40);
      await get('ian', '/travel/requests?scope=all').expect(200);
    });

    it('filters by kind, status, q (reference / route), dates and high priority', async () => {
      const kind = await get('tom', '/travel/requests?scope=all&kind=flight&perPage=100').expect(200);
      expect(kind.body.data.every((r: { kind: string }) => r.kind === 'flight')).toBe(true);
      const ref = await get('tom', '/travel/requests?scope=all&q=trv-000003').expect(200);
      expect(ref.body.data.map((r: { reference: string }) => r.reference)).toEqual(['TRV-000003']);
      const route = await get('tom', '/travel/requests?scope=all&q=westbay&perPage=100').expect(200);
      expect(route.body.data.length).toBeGreaterThanOrEqual(2);
      const high = await get('tom', '/travel/requests?scope=all&highPriority=true&status=to_book').expect(200);
      expect(high.body.data.map((r: { reference: string }) => r.reference).sort()).toEqual(
        ['TRV-000002', 'TRV-000007', 'TRV-000013'].sort(),
      );
      expect(high.body.data.every((r: { isHighPriority: boolean }) => r.isHighPriority)).toBe(true);
      const today = new Date().toISOString().slice(0, 10);
      const past = await get('tom', `/travel/requests?scope=all&to=${today}&from=2000-01-01&perPage=100`).expect(200);
      expect(past.body.data.every((r: { startsAt: string }) => new Date(r.startsAt) < new Date(Date.now() + DAY))).toBe(
        true,
      );
    });

    it('rejects unknown sort fields and filter values with 422', async () => {
      expect((await get('emma', '/travel/requests?sort=route').expect(422)).body.errors).toHaveProperty('sort');
      expect((await get('emma', '/travel/requests?status=nope').expect(422)).body.code).toBe('validation_failed');
    });
  });

  describe('preview (SPEC_RESOLUTIONS #3)', () => {
    const preview = (who: string, body: object) =>
      t.http().post('/api/v1/travel/requests/preview').set('Authorization', auth[who]).send(body);

    it('returns reasons, candidates and the default approver for S-V1', async () => {
      const res = await preview('emma', {
        kind: 'car',
        travellerId: ids.emma,
        car: { carClassId: ecmr, equipment: { automaticRequired: true, foreignTravel: true } },
      }).expect(200);
      expect(res.body).toMatchObject({
        needsApproval: true,
        reasons: [
          { code: 'car_automatic_required', label: 'Automatic transmission (guaranteed)' },
          { code: 'car_foreign_travel', label: 'Foreign travel' },
        ],
        exemption: null,
        defaultApproverId: ids.max,
        autoApproval: null,
        isHighPriority: false,
        specialEquipmentReasonRequired: true,
      });
      expect(res.body.approverCandidates.map((c: { user: { id: string } }) => c.user.id)).toEqual([ids.max, ids.clara]);
    });

    it('is lenient: only kind and travellerId are mandatory, invalid values are ignored', async () => {
      const res = await preview('emma', {
        kind: 'car',
        travellerId: ids.emma,
        car: { carClassId: 'nope', equipment: { estate: 'yes', diesel: true }, pickupAt: iso(1), unknown: 1 },
      }).expect(200);
      expect(res.body.reasons.map((r: { code: string }) => r.code)).toEqual(['car_diesel']);
      expect(res.body.isHighPriority).toBe(true);
      expect((await preview('emma', { kind: 'train' }).expect(422)).body.errors).toHaveProperty('travellerId');
      await preview('emma', { travellerId: ids.emma }).expect(422);
    });

    it('flags upgrades, exemptions, auto-approvals and team rule', async () => {
      const upgrade = await preview('emma', { kind: 'car', travellerId: ids.emma, car: { carClassId: idar } }).expect(
        200,
      );
      expect(upgrade.body.reasons.map((r: { code: string }) => r.code)).toEqual(['vehicle_class_upgrade']);
      const exec = await preview('clara', { kind: 'flight', travellerId: ids.clara }).expect(200);
      expect(exec.body).toMatchObject({
        needsApproval: false,
        exemption: { code: 'executive_traveller' },
        defaultApproverId: null,
      });
      const auto = await preview('max', { kind: 'flight', travellerId: ids.emma }).expect(200);
      expect(auto.body).toMatchObject({ needsApproval: true, autoApproval: 'requester_is_approver' });
      const train = await preview('emma', { kind: 'train', travellerId: ids.emma, train: { fareType: 'flex' } }).expect(
        200,
      );
      expect(train.body).toMatchObject({ needsApproval: false, reasons: [], specialEquipmentReasonRequired: false });
      const notMine = await preview('emma', { kind: 'train', travellerId: ids.sdkAgent }).expect(422);
      expect(notMine.body.errors.travellerId).toEqual(['You can only request for yourself or your team']);
    });
  });

  describe('create', () => {
    it('car with a reason -> pending_approval, approver notified, audit row', async () => {
      const res = await create(
        'emma',
        carBody(
          ids.emma,
          { comment: 'Customer visit' },
          {
            equipment: equipment({ diesel: true }),
            specialEquipmentReason: 'Long motorway distance',
          },
        ),
      ).expect(201);
      expect(res.headers.location).toBe(`/api/v1/travel/requests/${res.body.id}`);
      expect(res.body).toMatchObject({
        reference: expect.stringMatching(/^TRV-0000(4[1-9]|[5-9]\d)$/),
        status: 'pending_approval',
        route: 'Riverton → Lakeside',
        approvalReasons: [{ code: 'car_diesel', label: 'Diesel engine' }],
        approver: expect.objectContaining({ id: ids.max }),
        approverSelection: 'auto',
        approverReason: 'direct_manager',
        requester: expect.objectContaining({ id: ids.emma }),
        availableActions: ['withdraw'],
        costCenter: expect.objectContaining({ code: 'CC-2100' }),
        car: expect.objectContaining({ destination: 'Lakeside', specialEquipmentReason: 'Long motorway distance' }),
        comment: 'Customer visit',
        version: 1,
      });
      const mails = await t.prisma.emailMessage.findMany({ where: { entityId: res.body.id } });
      expect(mails).toEqual([
        expect.objectContaining({
          templateId: 'travel.approval_requested',
          to: ['max.manager@example.com'],
          subject: 'Travel approval needed: Emma Employee – car Riverton → Lakeside',
        }),
      ]);
      const inApp = await t.prisma.notification.findMany({ where: { entityId: res.body.id } });
      expect(inApp.map((n) => n.userId)).toEqual([ids.max]);
      const audit = await t.prisma.auditLog.findMany({ where: { entityId: res.body.id } });
      expect(audit).toEqual([
        expect.objectContaining({ action: 'create', actingAs: 'self', toState: 'pending_approval' }),
      ]);
    });

    it('approver creating for a report is auto-approved (requester_is_approver)', async () => {
      const res = await create('max', flightBody(ids.emma)).expect(201);
      expect(res.body).toMatchObject({
        status: 'to_book',
        needsApproval: true,
        approvalReasons: [{ code: 'flight' }],
        approval: {
          autoApproval: 'requester_is_approver',
          actingAs: 'system',
          by: expect.objectContaining({ id: ids.max }),
        },
      });
      const audit = await t.prisma.auditLog.findMany({
        where: { entityId: res.body.id },
        orderBy: { occurredAt: 'asc' },
      });
      expect(audit.map((a) => [a.action, a.actingAs, a.toState])).toEqual([
        ['create', 'requester', 'pending_approval'],
        ['auto_approve', 'system', 'to_book'],
      ]);
      const templates = (await t.prisma.emailMessage.findMany({ where: { entityId: res.body.id } })).map(
        (m) => m.templateId,
      );
      expect(templates.sort()).toEqual(['travel.approved', 'travel.created_for_you']);
    });

    it('executive traveller is exempt; no-reason trips go straight to the desk', async () => {
      const exec = await create('clara', flightBody(ids.clara)).expect(201);
      expect(exec.body).toMatchObject({
        status: 'to_book',
        needsApproval: false,
        approvalReasons: [],
        approvalExemption: { code: 'executive_traveller' },
        approver: null,
      });
      const train = await create('emma', trainBody(ids.emma, { companionIds: [ids.max] })).expect(201);
      expect(train.body).toMatchObject({
        status: 'to_book',
        route: 'Riverton Central → Hillford Central',
        train: expect.objectContaining({ companions: [expect.objectContaining({ id: ids.max })] }),
      });
      const mail = await t.prisma.emailMessage.findFirstOrThrow({ where: { entityId: train.body.id } });
      expect(mail).toMatchObject({
        templateId: 'travel.submitted_to_desk',
        to: ['travel-desk@example.com'],
        cc: ['emma.employee@example.com'],
      });
      // the companion can view the trip (read-only)
      const companion = await get('max', `/travel/requests/${train.body.id}`).expect(200);
      expect(companion.body.availableActions).toEqual([]);
    });

    it('accepts a manual approver from the chain, rejects others (422 approverId)', async () => {
      const manual = await create('emma', { ...flightBody(ids.emma), approverId: ids.clara }).expect(201);
      expect(manual.body).toMatchObject({
        approver: expect.objectContaining({ id: ids.clara }),
        approverSelection: 'manual',
        approverReason: null,
      });
      const wrong = await create('emma', { ...flightBody(ids.emma), approverId: ids.tom }).expect(422);
      expect(wrong.body.errors).toHaveProperty('approverId');
      // a site manager is never selectable (Sofia for her own technician)
      const hilTech = (await t.prisma.travelRequest.findUniqueOrThrow({ where: { number: 8 } })).travellerId;
      const sofiaPick = await create('sofia', { ...flightBody(hilTech), approverId: ids.sofia }).expect(422);
      expect(sofiaPick.body.errors).toHaveProperty('approverId');
    });

    it('validates car input (422 with dot paths)', async () => {
      const res = await create(
        'emma',
        carBody(
          ids.emma,
          { costCenterId: (await t.prisma.costCenter.findUniqueOrThrow({ where: { code: 'CC-1000' } })).id },
          {
            carClassId: xvmr,
            pickupAt: iso(-1),
            returnAt: iso(-2),
            equipment: equipment({ foreignTravel: true }),
            minPayloadKg: 500,
            handover: { mode: 'branch' },
            dropOff: { mode: 'collection' },
            driver: {
              firstName: 'Emma',
              lastName: 'Employee',
              email: 'emma.employee@example.com',
              phone: '555-0107',
              birthDate: new Date(Date.now() - 10 * 365 * DAY).toISOString().slice(0, 10),
            },
            specialEquipmentReason: 'short',
          },
        ),
      ).expect(422);
      expect(Object.keys(res.body.errors).sort()).toEqual(
        [
          'car.carClassId',
          'car.pickupAt',
          'car.returnAt',
          'car.foreignCountries',
          'car.minPayloadKg',
          'car.handover.branch',
          'car.dropOff.address',
          'car.driver.birthDate',
          'car.specialEquipmentReason',
          'costCenterReason',
        ].sort(),
      );
    });

    it('validates shapes, recharge, train and flight rules', async () => {
      const unknown = await create('emma', { ...trainBody(ids.emma), extra: true }).expect(422);
      expect(unknown.body.code).toBe('validation_failed');
      const recharge = await create('emma', {
        ...trainBody(ids.emma),
        recharge: { customer: 'Customer Westbay' },
      }).expect(422);
      expect(recharge.body.errors).toHaveProperty(['recharge.projectNumber']);
      const train = await create(
        'emma',
        trainBody(ids.emma, { tripType: 'one_way', companionIds: [ids.emma, ids.max, ids.max], seatReservations: 7 }),
      ).expect(422);
      expect(train.body.errors).toHaveProperty(['train.seatReservations']);
      const train2 = await create(
        'emma',
        trainBody(ids.emma, { tripType: 'one_way', companionIds: [ids.emma, ids.max, ids.max] }),
      ).expect(422);
      expect(Object.keys(train2.body.errors).sort()).toEqual([
        'train.companionIds.0',
        'train.companionIds.2',
        'train.returnAt',
      ]);
      const flight = await create(
        'emma',
        flightBody(ids.emma, { returnFrom: null, returnDepartureAt: iso(19) }),
      ).expect(422);
      expect(Object.keys(flight.body.errors).sort()).toEqual(['flight.returnDepartureAt', 'flight.returnFrom']);
      const kind = await create('emma', { kind: 'boat', travellerId: ids.emma }).expect(422);
      expect(kind.body.code).toBe('validation_failed');
    });

    it('enforces "creating for others" (SPEC §6.4); the desk may book for anyone', async () => {
      const res = await create('emma', trainBody(ids.sdkAgent)).expect(422);
      expect(res.body.errors.travellerId).toEqual(['You can only request for yourself or your team']);
      const desk = await create('tom', trainBody(ids.sdkAgent)).expect(201);
      expect(desk.body.requester.id).toBe(ids.tom);
      const audit = await t.prisma.auditLog.findFirstOrThrow({ where: { entityId: desk.body.id, action: 'create' } });
      expect(audit.actingAs).toBe('back_office');
    });
  });

  describe('approval transitions (SPEC §5.2)', () => {
    it('Max approves S-V1: to_book, desk mailbox notified, decision recorded', async () => {
      const id = await requestId(1);
      const res = await act('max', id, 'approve', { comment: 'Have a good trip' }).expect(200);
      expect(res.body).toMatchObject({
        status: 'to_book',
        approval: {
          by: expect.objectContaining({ id: ids.max }),
          actingAs: 'approver',
          comment: 'Have a good trip',
          autoApproval: null,
        },
        version: 2,
      });
      const mail = await t.prisma.emailMessage.findFirstOrThrow({
        where: { entityId: id, templateId: 'travel.approved' },
      });
      expect(mail.to).toEqual(['travel-desk@example.com']);
      expect(mail.cc).toEqual(['emma.employee@example.com']);
      const audit = await t.prisma.auditLog.findFirstOrThrow({ where: { entityId: id, action: 'approve' } });
      expect(audit).toMatchObject({ actingAs: 'approver', fromState: 'pending_approval', toState: 'to_book' });
      // 409 once decided
      expect((await act('max', id, 'approve').expect(409)).body.code).toBe('invalid_transition');
    });

    it('deputy approval (Max for Priya) and manager-chain override (Clara above Max)', async () => {
      const sv11 = await requestId(11);
      await act('max', sv11, 'approve').expect(200);
      expect(
        (await t.prisma.auditLog.findFirstOrThrow({ where: { entityId: sv11, action: 'approve' } })).actingAs,
      ).toBe('deputy');
      const sv9 = await requestId(9);
      const res = await act('clara', sv9, 'approve').expect(200);
      expect(res.body.approval.actingAs).toBe('manager_chain');
    });

    it('decline needs a reason; the traveller cannot decide; others get 403', async () => {
      const sv8 = await requestId(8);
      expect((await act('max', sv8, 'decline', {}).expect(422)).body.errors).toHaveProperty('reason');
      expect((await act('max', sv8, 'decline', { reason: 'no' }).expect(422)).body.errors).toHaveProperty('reason');
      expect((await act('sofia', sv8, 'withdraw').expect(403)).body.code).toBe('forbidden');
      const res = await act('max', sv8, 'decline', { reason: 'Please use the team van.' }).expect(200);
      expect(res.body).toMatchObject({
        status: 'declined',
        declineReason: 'Please use the team van.',
        availableActions: [],
      });
      const mail = await t.prisma.emailMessage.findFirstOrThrow({
        where: { entityId: sv8, templateId: 'travel.declined' },
      });
      expect(mail.subject).toBe('Travel request declined: Hillford → Eastgate');
    });

    it('withdraw by the traveller notifies the approver; unknown action 404', async () => {
      const created = await create('emma', flightBody(ids.emma)).expect(201);
      expect((await act('emma', created.body.id, 'approve').expect(403)).body.code).toBe('forbidden');
      expect((await act('emma', created.body.id, 'explode').expect(404)).body.code).toBe('not_found');
      expect((await act('max', created.body.id, 'withdraw').expect(403)).body.code).toBe('forbidden');
      const res = await act('emma', created.body.id, 'withdraw', { reason: 'Plans changed' }).expect(200);
      expect(res.body).toMatchObject({ status: 'cancelled', cancellationReason: 'Plans changed' });
      const mail = await t.prisma.emailMessage.findFirstOrThrow({
        where: { entityId: created.body.id, templateId: 'travel.withdrawn' },
      });
      expect(mail.to).toEqual(['max.manager@example.com']);
    });

    it('approve is blocked for trips that already started (#11); decline still works', async () => {
      // the desk may enter trips retroactively
      const past = await create(
        'tom',
        flightBody(ids.emma, { outboundDepartureAt: iso(-2), returnDepartureAt: iso(-1) }),
      ).expect(201);
      expect(past.body.status).toBe('pending_approval');
      const asMax = await get('max', `/travel/requests/${past.body.id}`).expect(200);
      expect(asMax.body.availableActions).toEqual(['decline']);
      expect((await act('max', past.body.id, 'approve').expect(409)).body.code).toBe('invalid_transition');
      await act('max', past.body.id, 'decline', { reason: 'Too late for an approval.' }).expect(200);
    });

    it('timeline lists create and decisions with actor labels', async () => {
      const res = await get('emma', `/travel/requests/${await requestId(3)}/timeline`).expect(200);
      expect(res.body.map((e: { action: string }) => e.action)).toEqual(['create', 'approve', 'book']);
      expect(res.body[0]).toMatchObject({
        entityLabel: 'TRV-000003',
        actingAs: 'self',
        summary: 'Emma Employee submitted the request',
      });
    });
  });
});
