import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../support/test-app';

/** SPEC §5.3 transitions, guards and the §3.3 permission matrix for assets. */
describe('assets: lifecycle and permissions', () => {
  let t: TestApp;
  let emma: string;
  let max: string;
  let arne: string;
  let ian: string;
  let emmaId: string;

  const idOf = async (number: number) =>
    (await t.prisma.asset.findUniqueOrThrow({ where: { number }, select: { id: true } })).id;
  const platformId = async (name: string) =>
    (await t.prisma.platform.findUniqueOrThrow({ where: { name }, select: { id: true } })).id;
  const act = (auth: string, id: string, action: string, body: object = {}) =>
    t.http().post(`/api/v1/assets/${id}/actions/${action}`).set('Authorization', auth).send(body);
  const get = (auth: string, id: string) => t.http().get(`/api/v1/assets/${id}`).set('Authorization', auth);
  /** First asset matching the filter (seeded data). */
  const find = async (where: Parameters<TestApp['prisma']['asset']['findFirstOrThrow']>[0]) =>
    (await t.prisma.asset.findFirstOrThrow({ ...where, select: { id: true } })).id;

  beforeAll(async () => {
    t = await createTestApp({ seed: ['core', 'assets'] });
    [emma, max, arne, ian] = await Promise.all([t.login('emma'), t.login('max'), t.login('arne'), t.login('ian')]);
    emmaId = await t.userId('emma');
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('seed (SPEC §10.4)', () => {
    it('has 120 assets and 25 models in the specified distribution', async () => {
      expect(await t.prisma.asset.count()).toBe(120);
      expect(await t.prisma.assetModel.count()).toBe(25);
      const byStatus = await t.prisma.asset.groupBy({ by: ['status'], _count: { _all: true } });
      expect(Object.fromEntries(byStatus.map((g) => [g.status, g._count._all]))).toEqual({
        in_use: 82,
        pending_acceptance: 4,
        in_stock: 22,
        in_repair: 5,
        scrapped: 7,
      });
      expect(await t.prisma.asset.count({ where: { deletedAt: { not: null } } })).toBe(2);
      expect(await t.prisma.auditLog.count({ where: { entityType: 'asset', action: 'update' } })).toBe(6);
      expect(await t.prisma.auditLog.count({ where: { entityType: 'asset', action: 'cost_center_sync' } })).toBe(2);
    });

    it('gives Emma two devices to accept (S-A1, S-A2) and two in use (S-A3, S-A4), without admin notes', async () => {
      const res = await t.http().get('/api/v1/assets/mine').set('Authorization', emma).expect(200);
      expect(res.body.pending.map((a: { assetTag: string }) => a.assetTag).sort()).toEqual(['AST-00115', 'AST-00118']);
      expect(res.body.active.map((a: { assetTag: string }) => a.assetTag).sort()).toEqual(['AST-00064', 'AST-00071']);
      const laptop = res.body.pending.find((a: { assetTag: string }) => a.assetTag === 'AST-00118');
      expect(laptop).toMatchObject({
        status: 'pending_acceptance',
        model: { name: 'Vireo Pro 14' },
        deviceType: { code: 'laptop', requiresPlatform: true },
        availableActions: ['accept', 'decline'],
        notes: null,
        currentAssignment: { assignedBy: { displayName: 'Arne Assets' }, acceptedAt: null, reminderCount: 0 },
      });
      expect(laptop.applicablePlatforms.map((p: { name: string }) => p.name)).toEqual([
        'Atlas Desktop 11',
        'Atlas Desktop 12',
        'Strata OS 15',
      ]);
      const phone = res.body.pending.find((a: { assetTag: string }) => a.assetTag === 'AST-00115');
      expect(phone.currentAssignment.reminderCount).toBe(1);
    });

    it('gives every persona 2-4 devices', async () => {
      for (const persona of ['emma', 'max', 'sofia', 'clara', 'tom', 'tina', 'arne', 'paula', 'ian']) {
        const n = await t.prisma.asset.count({ where: { assignedUser: { personaKey: persona }, deletedAt: null } });
        expect(n, persona).toBeGreaterThanOrEqual(2);
        expect(n, persona).toBeLessThanOrEqual(4);
      }
    });
  });

  describe('visibility (D5)', () => {
    it("hides other people's assets (404) and the admin list from employees (403)", async () => {
      const laptop = await idOf(118);
      await get(max, laptop).expect(404);
      await get(emma, laptop).expect(200);
      await get(emma, '00000000-not-a-uuid').expect(404);
      await t.http().get('/api/v1/assets').set('Authorization', emma).expect(403);
      await t.http().get('/api/v1/assets/dashboard').set('Authorization', emma).expect(403);
      await t.http().get('/api/v1/assets/export.csv').set('Authorization', max).expect(403);
    });

    it('shows notes and history to admins only; the timeline is 403 for the holder', async () => {
      const monitor = await idOf(64);
      await t.http().get(`/api/v1/assets/${monitor}/timeline`).set('Authorization', emma).expect(403);
      await t.http().get(`/api/v1/assets/${monitor}/assignments`).set('Authorization', emma).expect(403);
      await t.http().get(`/api/v1/assets/${monitor}/timeline`).set('Authorization', max).expect(404);
      const timeline = await t.http().get(`/api/v1/assets/${monitor}/timeline`).set('Authorization', arne).expect(200);
      expect(timeline.body.map((e: { action: string }) => e.action)).toEqual(['create', 'assign', 'accept', 'update']);
      expect(timeline.body[1].summary).toBe('Arne Assets assigned the device to Emma Employee (back office)');
      expect(timeline.body[3].changes[0]).toMatchObject({ field: 'serialNumber', label: 'Serial number' });
    });
  });

  describe('accept / decline (assigned user only)', () => {
    it('admins cannot accept for the user (403); others do not see the asset (404)', async () => {
      const laptop = await idOf(118);
      const res = await act(arne, laptop, 'accept', { platformId: await platformId('Strata OS 15') }).expect(403);
      expect(res.body.code).toBe('forbidden');
      await act(max, laptop, 'accept', {}).expect(404);
    });

    it('requires an applicable, active platform for device types that need one (422)', async () => {
      const laptop = await idOf(118);
      let res = await act(emma, laptop, 'accept', {}).expect(422);
      expect(res.body.errors).toHaveProperty('platformId');
      res = await act(emma, laptop, 'accept', { platformId: await platformId('Pocket OS 18') }).expect(422);
      expect(res.body.errors).toHaveProperty('platformId');
      const phone = await idOf(115);
      res = await act(emma, phone, 'accept', { platformId: await platformId('Pocket OS 17') }).expect(422);
      expect(res.body.errors).toHaveProperty('platformId');
      res = await act(emma, laptop, 'accept', { platformId: await platformId('Strata OS 15'), extra: 1 }).expect(422);
      expect(res.body.code).toBe('validation_failed');
    });

    it("accept: in use, platform set, cost centre switches to the user's, it-support is told", async () => {
      const laptop = await idOf(118);
      const res = await act(emma, laptop, 'accept', { platformId: await platformId('Strata OS 15') }).expect(200);
      expect(res.body).toMatchObject({
        status: 'in_use',
        platform: { name: 'Strata OS 15' },
        costCenter: { code: 'CC-2100' },
        assignedUser: { id: emmaId },
        availableActions: [],
      });
      expect(res.body.currentAssignment.acceptedAt).not.toBeNull();
      const mail = await t.prisma.emailMessage.findFirstOrThrow({
        where: { templateId: 'assets.assignment_accepted', entityId: laptop },
      });
      expect(mail.to).toEqual(['it-support@example.com']);
      expect(mail.subject).toBe('Emma Employee accepted AST-00118');
      const audit = await t.prisma.auditLog.findFirstOrThrow({
        where: { entityId: laptop, action: 'accept' },
        orderBy: { occurredAt: 'desc' },
      });
      expect(audit).toMatchObject({
        actorId: emmaId,
        actingAs: 'self',
        fromState: 'pending_acceptance',
        toState: 'in_use',
      });
      await act(emma, laptop, 'accept', { platformId: await platformId('Strata OS 15') }).expect(409);
    });

    it('decline needs a reason (3-1000); the device goes back to stock with the default cost centre', async () => {
      const phone = await idOf(115);
      let res = await act(emma, phone, 'decline', { reason: 'no' }).expect(422);
      expect(res.body.errors).toHaveProperty('reason');
      res = await act(emma, phone, 'decline', { reason: 'I already have a phone from the field team.' }).expect(200);
      expect(res.body).toMatchObject({ status: 'in_stock', assignedUser: null, costCenter: { code: 'CC-4900' } });
      await get(emma, phone).expect(404);
      const history = await t.http().get(`/api/v1/assets/${phone}/assignments`).set('Authorization', arne).expect(200);
      expect(history.body[0]).toMatchObject({
        user: { id: emmaId },
        declineReason: 'I already have a phone from the field team.',
      });
      expect(
        await t.prisma.emailMessage.count({ where: { templateId: 'assets.assignment_declined', entityId: phone } }),
      ).toBe(1);
      const inbox = await t.http().get('/api/v1/me/inbox?module=assets').set('Authorization', emma).expect(200);
      expect(inbox.body.data).toEqual([]);
    });
  });

  describe('admin transitions', () => {
    it('assign: admins only, active users only; notifies the user (email + in-app)', async () => {
      const phone = await idOf(115);
      await act(emma, phone, 'assign', { userId: emmaId }).expect(404);
      const inactive = await t.prisma.user.findFirstOrThrow({ where: { active: false } });
      let res = await act(arne, phone, 'assign', { userId: inactive.id }).expect(422);
      expect(res.body.errors).toHaveProperty('userId');
      await act(arne, phone, 'assign', {}).expect(422);
      res = await act(arne, phone, 'assign', { userId: emmaId, note: 'Second try' }).expect(200);
      expect(res.body).toMatchObject({
        status: 'pending_acceptance',
        assignedUser: { id: emmaId },
        availableActions: ['unassign', 'edit'],
        currentAssignment: { note: 'Second try', assignedBy: { displayName: 'Arne Assets' } },
      });
      const note = await t.prisma.notification.findFirstOrThrow({
        where: { userId: emmaId, templateId: 'assets.assignment_pending', entityId: phone },
        orderBy: { createdAt: 'desc' },
      });
      expect(note.title).toBe('Please confirm your new smartphone');
      expect(note.link).toBe(`/assets/${phone}`);
      await act(arne, phone, 'assign', { userId: emmaId }).expect(409);
    });

    it('unassign: pending -> in stock, user cleared', async () => {
      const phone = await idOf(115);
      const res = await act(arne, phone, 'unassign', { reason: 'Wrong colour' }).expect(200);
      expect(res.body).toMatchObject({ status: 'in_stock', assignedUser: null, currentAssignment: null });
      const audit = await t.prisma.auditLog.findFirstOrThrow({
        where: { entityId: phone, action: 'unassign' },
        orderBy: { occurredAt: 'desc' },
      });
      expect(audit.reason).toBe('Wrong colour');
    });

    it('return ok -> in stock and damaged -> in repair, the user gets a confirmation', async () => {
      const monitor = await idOf(64);
      let res = await act(arne, monitor, 'return', { condition: 'broken' }).expect(422);
      expect(res.body.errors).toHaveProperty('condition');
      res = await act(arne, monitor, 'return', { condition: 'ok' }).expect(200);
      expect(res.body).toMatchObject({ status: 'in_stock', assignedUser: null, costCenter: { code: 'CC-4900' } });
      expect(
        await t.prisma.notification.count({
          where: { userId: emmaId, templateId: 'assets.returned', entityId: monitor },
        }),
      ).toBe(1);

      const headset = await idOf(71);
      res = await act(arne, headset, 'return', { condition: 'damaged', note: 'Cable cut' }).expect(200);
      expect(res.body).toMatchObject({ status: 'in_repair', assignedUser: null });
      res = await act(arne, headset, 'complete_repair', {}).expect(200);
      expect(res.body.status).toBe('in_stock');
    });

    it('send_to_repair keeps the holder; complete_repair returns the device to them', async () => {
      const laptop = await idOf(118);
      let res = await act(arne, laptop, 'send_to_repair', {}).expect(422);
      expect(res.body.errors).toHaveProperty('note');
      res = await act(arne, laptop, 'send_to_repair', { note: 'Keyboard sticks' }).expect(200);
      expect(res.body).toMatchObject({ status: 'in_repair', assignedUser: { id: emmaId } });
      const mine = await t.http().get('/api/v1/assets/mine').set('Authorization', emma).expect(200);
      expect(mine.body.active.find((a: { id: string }) => a.id === laptop).status).toBe('in_repair');
      res = await act(ian, laptop, 'complete_repair', { note: 'Keyboard replaced' }).expect(200);
      expect(res.body).toMatchObject({
        status: 'in_use',
        assignedUser: { id: emmaId },
        costCenter: { code: 'CC-2100' },
      });
      const audit = await t.prisma.auditLog.findFirstOrThrow({
        where: { entityId: laptop, action: 'complete_repair' },
      });
      expect(audit).toMatchObject({ actingAs: 'admin', reason: 'Keyboard replaced' });
    });

    it('scrap from in stock or in repair closes the assignment; scrapped is final', async () => {
      const inRepairAssigned = await find({ where: { status: 'in_repair', assignedUser: { personaKey: 'max' } } });
      let res = await act(arne, inRepairAssigned, 'scrap', { reason: 'Not worth repairing' }).expect(200);
      expect(res.body).toMatchObject({ status: 'scrapped', assignedUser: null, availableActions: ['delete'] });
      const open = await t.prisma.assetAssignment.count({
        where: { assetId: inRepairAssigned, returnedAt: null, declinedAt: null, unassignedAt: null },
      });
      expect(open).toBe(0);
      const bodies: Record<string, object> = {
        assign: { userId: emmaId },
        send_to_repair: { note: 'again' },
        complete_repair: {},
        scrap: { reason: 'again' },
      };
      for (const [action, body] of Object.entries(bodies)) {
        res = await act(arne, inRepairAssigned, action, body).expect(409);
        expect(res.body.code).toBe('invalid_transition');
      }
      res = await t
        .http()
        .patch(`/api/v1/assets/${inRepairAssigned}`)
        .set('Authorization', arne)
        .send({ notes: 'x' })
        .expect(409);
      expect(res.body.code).toBe('invalid_transition');
      const inUse = await idOf(118);
      await act(arne, inUse, 'scrap', { reason: 'Not allowed while in use' }).expect(409);
      await act(arne, inUse, 'teleport', {}).expect(404);
    });

    it('soft delete only in stock or scrapped; deleted assets accept no actions', async () => {
      const inUse = await idOf(118);
      let res = await t.http().delete(`/api/v1/assets/${inUse}`).set('Authorization', arne).expect(409);
      expect(res.body.code).toBe('invalid_transition');
      await t.http().delete(`/api/v1/assets/${inUse}`).set('Authorization', emma).expect(403);
      const stock = await idOf(115);
      await t.http().delete(`/api/v1/assets/${stock}`).set('Authorization', arne).expect(204);
      res = await t.http().delete(`/api/v1/assets/${stock}`).set('Authorization', arne).expect(409);
      expect(res.body.code).toBe('invalid_transition');
      await act(arne, stock, 'assign', { userId: emmaId }).expect(409);
      const detail = await get(arne, stock).expect(200);
      expect(detail.body.deletedAt).not.toBeNull();
      expect(detail.body.availableActions).toEqual([]);
    });
  });

  describe('edit (PATCH)', () => {
    it('writes a field diff and bumps the version; stale versions conflict', async () => {
      const id = await find({
        where: { status: 'in_stock', deletedAt: null, model: { deviceType: { code: 'monitor' } } },
      });
      const before = await get(arne, id).expect(200);
      const res = await t
        .http()
        .patch(`/api/v1/assets/${id}`)
        .set('Authorization', arne)
        .send({ notes: 'Spare for the Campus meeting rooms.', name: 'MON-SPARE', version: before.body.version })
        .expect(200);
      expect(res.body).toMatchObject({ notes: 'Spare for the Campus meeting rooms.', name: 'MON-SPARE' });
      expect(res.body.version).toBe(before.body.version + 1);
      const stale = await t
        .http()
        .patch(`/api/v1/assets/${id}`)
        .set('Authorization', arne)
        .send({ notes: 'other', version: before.body.version })
        .expect(409);
      expect(stale.body.code).toBe('version_conflict');
      const audit = await t.prisma.auditLog.findFirstOrThrow({
        where: { entityId: id, action: 'update' },
        orderBy: { occurredAt: 'desc' },
      });
      expect((audit.changes as { field: string }[]).map((c) => c.field).sort()).toEqual(['name', 'notes']);
    });

    it('keeps the cost centre read-only while assigned (422, SPEC_RESOLUTIONS #22)', async () => {
      const assigned = await idOf(118);
      const cc = await t.prisma.costCenter.findUniqueOrThrow({ where: { code: 'CC-4100' } });
      const res = await t
        .http()
        .patch(`/api/v1/assets/${assigned}`)
        .set('Authorization', arne)
        .send({ costCenterId: cc.id })
        .expect(422);
      expect(res.body.errors).toHaveProperty('costCenterId');
      const same = await t.prisma.asset.findUniqueOrThrow({ where: { id: assigned } });
      await t
        .http()
        .patch(`/api/v1/assets/${assigned}`)
        .set('Authorization', arne)
        .send({ costCenterId: same.costCenterId })
        .expect(200);
    });

    it('rejects a taken serial (409, case-insensitive), archived models and inapplicable platforms (422)', async () => {
      const id = await find({
        where: { status: 'in_stock', deletedAt: null, model: { deviceType: { code: 'laptop' } } },
      });
      const other = await t.prisma.asset.findUniqueOrThrow({ where: { number: 64 } });
      let res = await t
        .http()
        .patch(`/api/v1/assets/${id}`)
        .set('Authorization', arne)
        .send({ serialNumber: other.serialNumber.toLowerCase() })
        .expect(409);
      expect(res.body.code).toBe('serial_taken');
      const archived = await t.prisma.assetModel.findFirstOrThrow({ where: { archivedAt: { not: null } } });
      res = await t.http().patch(`/api/v1/assets/${id}`).set('Authorization', arne).send({ modelId: archived.id });
      expect(res.status).toBe(422);
      res = await t
        .http()
        .patch(`/api/v1/assets/${id}`)
        .set('Authorization', arne)
        .send({ platformId: await platformId('Pocket OS 18') })
        .expect(422);
      expect(res.body.errors).toHaveProperty('platformId');
      await t.http().patch(`/api/v1/assets/${id}`).set('Authorization', emma).send({ notes: 'x' }).expect(403);
    });
  });
});
