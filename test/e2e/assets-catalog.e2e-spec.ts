import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../support/test-app';

/** API.md §6.1 `/assets/catalog/*`: everyone reads, admins manage; in-use rows are protected. */
describe('assets: catalogue', () => {
  let t: TestApp;
  let emma: string;
  let arne: string;

  const typeId = async (code: string) => (await t.prisma.deviceType.findUniqueOrThrow({ where: { code } })).id;
  const manufacturer = (name: string) => t.prisma.manufacturer.findUniqueOrThrow({ where: { name } });
  const api = (path: string) => `/api/v1/assets/catalog${path}`;

  beforeAll(async () => {
    t = await createTestApp({ seed: ['core', 'assets'] });
    [emma, arne] = await Promise.all([t.login('emma'), t.login('arne')]);
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('device types', () => {
    it('lists the 7 seeded types in sort order with asset counts (everyone)', async () => {
      const res = await t.http().get(api('/device-types')).set('Authorization', emma).expect(200);
      expect(res.body.map((d: { code: string }) => d.code)).toEqual([
        'laptop',
        'desktop',
        'monitor',
        'smartphone',
        'tablet',
        'headset',
        'dock',
      ]);
      expect(res.body[0]).toMatchObject({ name: 'Laptop', requiresPlatform: true, assetCount: 40 });
    });

    it('creates, updates and deletes an unused type; duplicates are 422, in-use types 409', async () => {
      await t
        .http()
        .post(api('/device-types'))
        .set('Authorization', emma)
        .send({ code: 'printer', name: 'Printer', requiresPlatform: false, sortOrder: 80 })
        .expect(403);
      const created = await t
        .http()
        .post(api('/device-types'))
        .set('Authorization', arne)
        .send({ code: 'Printer', name: 'Printer', requiresPlatform: false, sortOrder: 80 })
        .expect(201);
      expect(created.body).toMatchObject({ code: 'printer', assetCount: 0 });
      expect(created.headers.location).toContain(created.body.id);
      const dup = await t
        .http()
        .post(api('/device-types'))
        .set('Authorization', arne)
        .send({ code: 'printer', name: 'Printer 2', requiresPlatform: false, sortOrder: 81 })
        .expect(422);
      expect(dup.body.errors).toHaveProperty('code');
      const updated = await t
        .http()
        .patch(api(`/device-types/${created.body.id}`))
        .set('Authorization', arne)
        .send({ name: 'Printer / scanner' })
        .expect(200);
      expect(updated.body.name).toBe('Printer / scanner');
      await t
        .http()
        .delete(api(`/device-types/${created.body.id}`))
        .set('Authorization', arne)
        .expect(204);
      const inUse = await t
        .http()
        .delete(api(`/device-types/${await typeId('dock')}`))
        .set('Authorization', arne)
        .expect(409);
      expect(inUse.body.code).toBe('in_use');
      await t
        .http()
        .delete(api('/device-types/00000000-0000-7000-8000-000000000000'))
        .set('Authorization', arne)
        .expect(404);
    });
  });

  describe('manufacturers and platforms', () => {
    it('filters by device type and hides archived rows unless asked', async () => {
      const tablets = await t
        .http()
        .get(api(`/manufacturers?deviceTypeId=${await typeId('tablet')}`))
        .set('Authorization', emma)
        .expect(200);
      expect(tablets.body.map((m: { name: string }) => m.name)).toEqual(['Marlowe Mobile', 'Quillon Devices']);
      const platforms = await t
        .http()
        .get(api(`/platforms?deviceTypeId=${await typeId('smartphone')}`))
        .set('Authorization', emma)
        .expect(200);
      expect(platforms.body.map((p: { name: string }) => p.name)).toEqual(['Pocket OS 18', 'Verdant Mobile 14']);
      const all = await t.http().get(api('/platforms?includeArchived=true')).set('Authorization', emma).expect(200);
      expect(all.body.find((p: { name: string }) => p.name === 'Pocket OS 17')).toMatchObject({ archived: true });
    });

    it('creates and archives a manufacturer; keeps device types its models use', async () => {
      const created = await t
        .http()
        .post(api('/manufacturers'))
        .set('Authorization', arne)
        .send({ name: 'Halcyon Peripherals', deviceTypeIds: [await typeId('headset')] })
        .expect(201);
      expect(created.body).toMatchObject({ archived: false, modelCount: 0, assetCount: 0 });
      const dup = await t
        .http()
        .post(api('/manufacturers'))
        .set('Authorization', arne)
        .send({ name: 'Halcyon Peripherals', deviceTypeIds: [] })
        .expect(422);
      expect(dup.body.errors).toHaveProperty('name');
      const archived = await t
        .http()
        .patch(api(`/manufacturers/${created.body.id}`))
        .set('Authorization', arne)
        .send({ archived: true })
        .expect(200);
      expect(archived.body.archived).toBe(true);
      const audit = await t.prisma.auditLog.findFirstOrThrow({
        where: { entityId: created.body.id, action: 'archive' },
      });
      expect(audit.entityType).toBe('manufacturer');
      const listed = await t.http().get(api('/manufacturers')).set('Authorization', emma).expect(200);
      expect(listed.body.some((m: { id: string }) => m.id === created.body.id)).toBe(false);

      const vireo = await manufacturer('Vireo Computing');
      const res = await t
        .http()
        .patch(api(`/manufacturers/${vireo.id}`))
        .set('Authorization', arne)
        .send({ deviceTypeIds: [await typeId('laptop')] })
        .expect(422);
      expect(res.body.errors).toHaveProperty('deviceTypeIds');
      await t
        .http()
        .post(api('/manufacturers'))
        .set('Authorization', arne)
        .send({ name: 'X', deviceTypeIds: ['00000000-0000-7000-8000-000000000000'] })
        .expect(422);
    });

    it('creates platforms and protects device types that assets run them on', async () => {
      const created = await t
        .http()
        .post(api('/platforms'))
        .set('Authorization', arne)
        .send({ name: 'Strata OS 16', deviceTypeIds: [await typeId('laptop'), await typeId('desktop')] })
        .expect(201);
      expect(created.body.deviceTypeIds).toHaveLength(2);
      const strata = await t.prisma.platform.findUniqueOrThrow({ where: { name: 'Strata OS 15' } });
      const res = await t
        .http()
        .patch(api(`/platforms/${strata.id}`))
        .set('Authorization', arne)
        .send({ deviceTypeIds: [await typeId('desktop')] })
        .expect(422);
      expect(res.body.errors).toHaveProperty('deviceTypeIds');
      await t
        .http()
        .patch(api(`/platforms/${strata.id}`))
        .set('Authorization', emma)
        .send({ name: 'x' })
        .expect(403);
    });
  });

  describe('models', () => {
    it('pages, filters and sorts by asset count', async () => {
      let res = await t.http().get(api('/models?perPage=5')).set('Authorization', emma).expect(200);
      expect(res.body.meta).toEqual({ page: 1, perPage: 5, total: 23, totalPages: 5 });
      res = await t.http().get(api('/models?includeArchived=true&perPage=100')).set('Authorization', emma).expect(200);
      expect(res.body.meta.total).toBe(25);
      res = await t.http().get(api('/models?sort=-assetCount&perPage=3')).set('Authorization', emma).expect(200);
      const counts = res.body.data.map((m: { assetCount: number }) => m.assetCount);
      expect([...counts].sort((a, b) => b - a)).toEqual(counts);
      res = await t.http().get(api('/models?q=marlowe x5')).set('Authorization', emma).expect(200);
      expect(res.body.data.map((m: { name: string }) => m.name)).toEqual([
        'Marlowe X5 128 GB Midnight',
        'Marlowe X5 256 GB Silver',
      ]);
      expect(res.body.data[0]).toMatchObject({ storageGb: 128, color: 'Midnight', deviceType: { code: 'smartphone' } });
    });

    it('requires the manufacturer to make the device type (422) and unique names per manufacturer', async () => {
      const skylark = await manufacturer('Skylark Displays');
      let res = await t
        .http()
        .post(api('/models'))
        .set('Authorization', arne)
        .send({ name: 'Skylark Phone', manufacturerId: skylark.id, deviceTypeId: await typeId('smartphone') })
        .expect(422);
      expect(res.body.errors).toHaveProperty('deviceTypeId');
      res = await t
        .http()
        .post(api('/models'))
        .set('Authorization', arne)
        .send({ name: 'skylark view 24', manufacturerId: skylark.id, deviceTypeId: await typeId('monitor') })
        .expect(422);
      expect(res.body.errors).toHaveProperty('name');
      const marlowe = await manufacturer('Marlowe Mobile');
      res = await t
        .http()
        .post(api('/models'))
        .set('Authorization', arne)
        .send({
          name: 'Marlowe X6 512 GB Dune',
          manufacturerId: marlowe.id,
          deviceTypeId: await typeId('smartphone'),
          storageGb: 512,
          color: 'Dune',
        })
        .expect(201);
      expect(res.body).toMatchObject({ storageGb: 512, color: 'Dune', archived: false, assetCount: 0 });
    });

    it('archives and restores; blocks deleting and re-typing models in use', async () => {
      const used = await t.prisma.assetModel.findFirstOrThrow({ where: { name: 'Skylark View 24' } });
      let res = await t
        .http()
        .patch(api(`/models/${used.id}`))
        .set('Authorization', arne)
        .send({ archived: true })
        .expect(200);
      expect(res.body.archived).toBe(true);
      res = await t
        .http()
        .patch(api(`/models/${used.id}`))
        .set('Authorization', arne)
        .send({ archived: false })
        .expect(200);
      expect(res.body.archived).toBe(false);
      const actions = await t.prisma.auditLog.findMany({
        where: { entityId: used.id, action: { in: ['archive', 'restore'] } },
        orderBy: { occurredAt: 'asc' },
      });
      expect(actions.map((a) => a.action)).toEqual(['archive', 'restore']);

      res = await t
        .http()
        .delete(api(`/models/${used.id}`))
        .set('Authorization', arne)
        .expect(409);
      expect(res.body.code).toBe('model_in_use');
      res = await t
        .http()
        .patch(api(`/models/${used.id}`))
        .set('Authorization', arne)
        .send({ deviceTypeId: await typeId('dock') })
        .expect(422);
      expect(res.body.code).toBe('validation_failed');

      const unused = await t.prisma.assetModel.findFirstOrThrow({ where: { name: 'Marlowe X6 512 GB Dune' } });
      await t
        .http()
        .delete(api(`/models/${unused.id}`))
        .set('Authorization', emma)
        .expect(403);
      await t
        .http()
        .delete(api(`/models/${unused.id}`))
        .set('Authorization', arne)
        .expect(204);
      await t
        .http()
        .delete(api(`/models/${unused.id}`))
        .set('Authorization', arne)
        .expect(404);
    });
  });
});
