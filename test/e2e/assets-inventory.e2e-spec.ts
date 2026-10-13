import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../support/test-app';

/** API.md §6.1: create, list/filter/sort, export, dashboard, counts and assignment history. */
describe('assets: inventory, dashboard and export', () => {
  let t: TestApp;
  let emma: string;
  let arne: string;
  let ian: string;

  const modelId = async (name: string) => (await t.prisma.assetModel.findFirstOrThrow({ where: { name } })).id;
  const platformId = async (name: string) => (await t.prisma.platform.findUniqueOrThrow({ where: { name } })).id;
  const typeId = async (code: string) => (await t.prisma.deviceType.findUniqueOrThrow({ where: { code } })).id;
  const list = (auth: string, query = '') => t.http().get(`/api/v1/assets${query}`).set('Authorization', auth);

  beforeAll(async () => {
    t = await createTestApp({ seed: ['core', 'assets'] });
    [emma, arne, ian] = await Promise.all([t.login('emma'), t.login('arne'), t.login('ian')]);
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('create', () => {
    it('creates an in-stock asset with the default cost centre, Location header and audit row', async () => {
      const res = await t
        .http()
        .post('/api/v1/assets')
        .set('Authorization', arne)
        .send({ serialNumber: 'TEST-0001', modelId: await modelId('Vireo Pro 14'), purchaseDate: '2019-06-03' })
        .expect(201);
      expect(res.headers.location).toBe(`/api/v1/assets/${res.body.id}`);
      expect(res.body).toMatchObject({
        assetTag: 'AST-00121',
        status: 'in_stock',
        costCenter: { code: 'CC-4900' },
        platform: null,
        purchaseDate: '2019-06-03',
        mdmEnrolled: false,
        notes: null,
        createdBy: { displayName: 'Arne Assets' },
        version: 1,
        availableActions: ['assign', 'send_to_repair', 'scrap', 'edit', 'delete'],
      });
      const audit = await t.prisma.auditLog.findFirstOrThrow({ where: { entityId: res.body.id } });
      expect(audit).toMatchObject({ action: 'create', toState: 'in_stock', actingAs: 'back_office' });
    });

    it('validates the body (422) and serial uniqueness (409, case-insensitive)', async () => {
      const post = (body: object, auth = arne) => t.http().post('/api/v1/assets').set('Authorization', auth).send(body);
      const laptop = await modelId('Vireo Pro 14');
      let res = await post({ serialNumber: 'test-0001', modelId: laptop }).expect(409);
      expect(res.body.code).toBe('serial_taken');
      res = await post({ serialNumber: '', modelId: laptop }).expect(422);
      expect(res.body.errors).toHaveProperty('serialNumber');
      await post({ serialNumber: 'X1', modelId: laptop, colour: 'red' }).expect(422);
      res = await post({ serialNumber: 'X1', modelId: await modelId('Vireo Pro 13 Classic') }).expect(422);
      expect(res.body.errors).toHaveProperty('modelId');
      res = await post({ serialNumber: 'X1', modelId: laptop, platformId: await platformId('Pocket OS 18') }).expect(
        422,
      );
      expect(res.body.errors).toHaveProperty('platformId');
      const inactive = await t.prisma.user.findFirstOrThrow({ where: { active: false } });
      res = await post({ serialNumber: 'X1', modelId: laptop, assignToUserId: inactive.id }).expect(422);
      expect(res.body.errors).toHaveProperty('assignToUserId');
      await post({ serialNumber: 'X1', modelId: laptop }, emma).expect(403);
    });

    it('assigns right away when assignToUserId is given (it_admin acts as admin)', async () => {
      const emmaId = await t.userId('emma');
      const res = await t
        .http()
        .post('/api/v1/assets')
        .set('Authorization', ian)
        .send({
          serialNumber: 'TEST-0002',
          modelId: await modelId('Brightfield Solo'),
          assignToUserId: emmaId,
          notes: 'Loaner for the conference',
        })
        .expect(201);
      expect(res.body).toMatchObject({
        status: 'pending_acceptance',
        assignedUser: { id: emmaId },
        notes: 'Loaner for the conference',
      });
      const rows = await t.prisma.auditLog.findMany({
        where: { entityId: res.body.id },
        orderBy: { occurredAt: 'asc' },
      });
      expect(rows.map((r) => [r.action, r.actingAs])).toEqual([
        ['create', 'admin'],
        ['assign', 'admin'],
      ]);
      const mine = await t.http().get('/api/v1/assets/mine').set('Authorization', emma).expect(200);
      expect(mine.body.pending.find((a: { id: string }) => a.id === res.body.id).notes).toBeNull();
    });
  });

  describe('list', () => {
    it('pages, filters and sorts (soft-deleted rows only on request)', async () => {
      let res = await list(arne, '?perPage=10&sort=assetTag').expect(200);
      expect(res.body.meta).toEqual({ page: 1, perPage: 10, total: 120, totalPages: 12 });
      const tags = res.body.data.map((a: { assetTag: string }) => a.assetTag);
      expect([...tags].sort()).toEqual(tags);
      expect(tags[0]).toBe('AST-00002'); // AST-00001 is scrapped and soft-deleted
      res = await list(arne, '?includeDeleted=true&perPage=1').expect(200);
      expect(res.body.meta.total).toBe(122);
      res = await list(arne, '?status=in_repair,scrapped&perPage=100').expect(200);
      expect(res.body.meta.total).toBe(10); // 5 in repair + 5 scrapped that are not deleted
      res = await list(arne, `?deviceTypeId=${await typeId('dock')}`).expect(200);
      expect(res.body.meta.total).toBe(4);
      res = await list(arne, '?q=ast-00118').expect(200);
      expect(res.body.data.map((a: { assetTag: string }) => a.assetTag)).toEqual(['AST-00118']);
      res = await list(arne, '?q=Emma&perPage=100').expect(200);
      expect(
        res.body.data.every(
          (a: { assignedUser: { displayName: string } }) => a.assignedUser.displayName === 'Emma Employee',
        ),
      ).toBe(true);
      res = await list(arne, '?sort=-purchaseDate&perPage=5').expect(200);
      const dates = res.body.data.map((a: { purchaseDate: string }) => a.purchaseDate);
      expect([...dates].sort().reverse()).toEqual(dates);
      res = await list(arne, '?sort=colour').expect(422);
      expect(res.body.errors).toHaveProperty('sort');
      await list(arne, '?status=lost').expect(422);
      res = await list(arne, '?page=99').expect(200);
      expect(res.body.data).toEqual([]);
    });

    it('filters by purchase date range and cost centre', async () => {
      const cc = await t.prisma.costCenter.findUniqueOrThrow({ where: { code: 'CC-4900' } });
      const res = await list(arne, `?costCenterId=${cc.id}&perPage=100`).expect(200);
      expect(res.body.data.every((a: { costCenter: { code: string } }) => a.costCenter.code === 'CC-4900')).toBe(true);
      const ranged = await list(arne, '?from=2019-06-03&to=2019-06-03').expect(200);
      expect(ranged.body.data.map((a: { purchaseDate: string }) => a.purchaseDate)).toEqual(['2019-06-03']);
    });
  });

  describe('export, dashboard, counts, history', () => {
    it('exports the filtered list as CSV with a BOM', async () => {
      const res = await t
        .http()
        .get('/api/v1/assets/export.csv?status=in_repair')
        .set('Authorization', arne)
        .buffer(true)
        .parse((response, done) => {
          let text = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => (text += chunk));
          response.on('end', () => done(null, text));
        })
        .expect(200);
      expect(res.headers['content-type']).toContain('text/csv');
      const text = res.body as string;
      expect(text.charCodeAt(0)).toBe(0xfeff);
      const lines = text.trim().split('\r\n');
      expect(lines[0]).toContain('Asset tag,Serial number');
      expect(lines).toHaveLength(6);
    });

    it('summarises the inventory for the dashboard', async () => {
      const res = await t.http().get('/api/v1/assets/dashboard').set('Authorization', arne).expect(200);
      const body = res.body;
      expect(body.totals.all).toBe(120);
      expect(body.byDeviceType.map((d: { deviceType: { code: string } }) => d.deviceType.code)).toEqual([
        'laptop',
        'desktop',
        'monitor',
        'smartphone',
        'tablet',
        'headset',
        'dock',
      ]);
      expect(body.byDeviceType[0]).toMatchObject({ total: 40 });
      expect(body.pendingAcceptance).toMatchObject({ total: 5, overdue: 1 });
      expect(body.pendingAcceptance.oldest[0].model.name).toBe('Quillon Slate 11 64 GB Silver');
      expect(body.recentActivity).toHaveLength(10);
      expect(body.recentActivity[0].asset.assetTag).toMatch(/^AST-\d{5}$/);
      expect(body.byManufacturer[0].total).toBeGreaterThanOrEqual(body.byManufacturer.at(-1).total);
    });

    it('dates waiting devices by their assignment, not by the last change', async () => {
      const tablet = await t.prisma.asset.findFirstOrThrow({
        where: { status: 'pending_acceptance', model: { name: 'Quillon Slate 11 64 GB Silver' } },
        include: {
          assignments: { where: { acceptedAt: null, declinedAt: null, unassignedAt: null, returnedAt: null } },
        },
      });
      const before = await t.http().get(`/api/v1/assets/${tablet.id}`).set('Authorization', arne).expect(200);
      await t
        .http()
        .patch(`/api/v1/assets/${tablet.id}`)
        .set('Authorization', arne)
        .send({ notes: 'Waits on the Hillford shelf.', version: before.body.version })
        .expect(200);
      const res = await t.http().get('/api/v1/assets/dashboard').set('Authorization', arne).expect(200);
      const row = res.body.pendingAcceptance.oldest.find((a: { id: string }) => a.id === tablet.id);
      expect(row.assignedAt).toBe(tablet.assignments[0].assignedAt.toISOString());
      expect(row.updatedAt).not.toBe(row.assignedAt);
    });

    it('counts queues for everyone and admin counts for admins only', async () => {
      const mine = await t.http().get('/api/v1/assets/queues/counts').set('Authorization', emma).expect(200);
      expect(mine.body).toEqual({ mine: { pending: 3 }, admin: null });
      const admin = await t.http().get('/api/v1/assets/queues/counts').set('Authorization', arne).expect(200);
      expect(admin.body).toEqual({
        mine: { pending: 0 },
        admin: { pendingAcceptance: 5, acceptanceOverdue: 1, inRepair: 5, inStock: 23 },
      });
    });

    it('lists the assignment history newest first', async () => {
      const declined = await t.prisma.assetAssignment.findFirstOrThrow({ where: { declinedAt: { not: null } } });
      const res = await t
        .http()
        .get(`/api/v1/assets/${declined.assetId}/assignments`)
        .set('Authorization', arne)
        .expect(200);
      expect(res.body[0]).toMatchObject({ declineReason: declined.declineReason, acceptedAt: null });
      const returned = await t.prisma.assetAssignment.findFirstOrThrow({
        where: { returnCondition: 'damaged', asset: { status: 'in_repair' } },
      });
      const history = await t
        .http()
        .get(`/api/v1/assets/${returned.assetId}/assignments`)
        .set('Authorization', arne)
        .expect(200);
      expect(history.body[0]).toMatchObject({ returnCondition: 'damaged' });
      expect(history.body[0].returnedAt).not.toBeNull();
    });
  });
});
