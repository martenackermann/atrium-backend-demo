import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDaysIso } from '@/common/time/time';
import { Clock } from '@/common/time/clock.service';
import { buildUsersExport } from '@/database/seed/export-users';
import { FixturesModule } from '../support/fixtures.module';
import { createTestApp, type TestApp } from '../support/test-app';

describe('core API: users, org, inbox, search, notifications, deputies, meta, admin', () => {
  let t: TestApp;
  let emma: string;
  let max: string;
  let ian: string;
  let today: string;

  beforeAll(async () => {
    t = await createTestApp({ imports: [FixturesModule] });
    [emma, max, ian] = await Promise.all([t.login('emma'), t.login('max'), t.login('ian')]);
    today = t.app.get(Clock).today();
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('users and org', () => {
    it('seeds 52 users (50 active) with personas', async () => {
      expect(await t.prisma.user.count()).toBe(52);
      expect(await t.prisma.user.count({ where: { active: true } })).toBe(50);
      expect(await t.prisma.user.count({ where: { personaKey: { not: null } } })).toBe(9);
    });

    it('matches the users.json export (fixed UUIDs, independent of SEED_TODAY)', async () => {
      const exported = buildUsersExport(4711).users;
      const rows = await t.prisma.user.findMany({ select: { id: true, email: true, managerId: true } });
      expect(rows.map((r) => `${r.id} ${r.email} ${r.managerId}`).sort()).toEqual(
        exported.map((u) => `${u.id} ${u.email} ${u.managerId}`).sort(),
      );
    });

    it('searches the user picker by name or email (active users only)', async () => {
      const res = await t.http().get('/api/v1/users?q=raman').set('Authorization', emma).expect(200);
      expect(res.body.meta).toEqual({ page: 1, perPage: 20, total: 1, totalPages: 1 });
      expect(res.body.data[0]).toMatchObject({ displayName: 'Priya Raman', department: { code: 'SDK' }, active: true });
      const all = await t.http().get('/api/v1/users?perPage=100').set('Authorization', emma).expect(200);
      expect(all.body.meta.total).toBe(50);
      const withInactive = await t
        .http()
        .get('/api/v1/users?perPage=100&includeInactive=true')
        .set('Authorization', ian)
        .expect(200);
      expect(withInactive.body.meta.total).toBe(52);
    });

    it('scope=team returns the reporting tree; role filters by stored or derived role', async () => {
      const team = await t.http().get('/api/v1/users?scope=team&perPage=100').set('Authorization', max).expect(200);
      expect(team.body.meta.total).toBe(16); // Emma, Sofia + 6 HIL, EAS lead + 5, dispatcher, senior tech (inactive excluded)
      const executives = await t.http().get('/api/v1/users?role=executive').set('Authorization', emma).expect(200);
      expect(executives.body.data.map((u: { displayName: string }) => u.displayName).sort()).toEqual([
        'Clara CEO',
        'Helen Brooks',
      ]);
    });

    it('returns a user profile with manager and direct reports', async () => {
      const res = await t
        .http()
        .get(`/api/v1/users/${await t.userId('max')}`)
        .set('Authorization', emma)
        .expect(200);
      expect(res.body).toMatchObject({
        displayName: 'Max Manager',
        manager: { displayName: 'Clara CEO' },
        roles: ['employee', 'manager'],
      });
      expect(res.body.directReports.length).toBe(5); // Emma, Sofia, EAS lead, dispatcher, senior tech
      await t.http().get('/api/v1/users/0192f1c2-8e4b-7c3a-9d2e-1a2b3c4d5e6f').set('Authorization', emma).expect(404);
    });

    it('resolves the approver chain with site-manager escalation (SPEC §6.1)', async () => {
      const tech = await t.prisma.user.findFirstOrThrow({
        where: { jobTitle: 'Field Technician', site: { code: 'HIL' }, active: true },
      });
      const res = await t.http().get(`/api/v1/users/${tech.id}/approvers`).set('Authorization', emma).expect(200);
      expect(res.body.exemption).toBeNull();
      expect(res.body.default).toMatchObject({
        user: { displayName: 'Max Manager' },
        reason: 'site_manager_escalation',
        isDefault: true,
      });
      expect(
        res.body.candidates.map((c: { user: { displayName: string }; selectable: boolean; level: number }) => [
          c.user.displayName,
          c.level,
          c.selectable,
        ]),
      ).toEqual([
        ['Sofia Site-Manager', 1, false],
        ['Max Manager', 2, true],
        ['Clara CEO', 3, true],
      ]);
      const clara = await t
        .http()
        .get(`/api/v1/users/${await t.userId('clara')}/approvers`)
        .set('Authorization', emma)
        .expect(200);
      expect(clara.body).toMatchObject({ exemption: 'executive_traveller', default: null, candidates: [] });
    });

    it('lists departments, sites and cost centres', async () => {
      const deps = await t.http().get('/api/v1/org/departments').set('Authorization', emma).expect(200);
      expect(deps.body.map((d: { code: string }) => d.code)).toEqual(['EXO', 'FIN', 'FLD', 'ITO', 'PPL', 'SDK']);
      expect(deps.body.find((d: { code: string }) => d.code === 'FLD')).toMatchObject({
        head: { displayName: 'Max Manager' },
        memberCount: 17,
      });
      const sites = await t.http().get('/api/v1/org/sites').set('Authorization', emma).expect(200);
      expect(sites.body.map((s: { code: string }) => s.code)).toEqual(['CAM', 'EAS', 'HIL', 'RIV']);
      const ccs = await t.http().get('/api/v1/org/cost-centers?active=true').set('Authorization', emma).expect(200);
      expect(ccs.body).toHaveLength(9);
    });
  });

  describe('inbox and search (provider framework)', () => {
    it('is empty for users without provider items', async () => {
      const res = await t.http().get('/api/v1/me/inbox').set('Authorization', emma).expect(200);
      expect(res.body).toEqual({
        data: [],
        meta: { total: 0, high: 0, byModule: { training: 0, travel: 0, assets: 0, people: 0 } },
      });
      const counts = await t.http().get('/api/v1/me/inbox/counts').set('Authorization', emma).expect(200);
      expect(counts.body).toEqual({ total: 0, high: 0, training: 0, travel: 0, assets: 0, people: 0 });
    });

    it('aggregates provider items in inbox order and filters by module/type', async () => {
      const res = await t.http().get('/api/v1/me/inbox').set('Authorization', max).expect(200);
      expect(res.body.data.map((i: { title: string }) => i.title)).toEqual(['Urgent', 'Sooner', 'Later', 'Undated']);
      expect(res.body.meta).toEqual({ total: 4, high: 1, byModule: { training: 4, travel: 0, assets: 0, people: 0 } });
      const filtered = await t.http().get('/api/v1/me/inbox?module=travel').set('Authorization', max).expect(200);
      expect(filtered.body.data).toEqual([]);
      await t.http().get('/api/v1/me/inbox?module=bogus').set('Authorization', max).expect(422);
    });

    it('search caps hits per provider and requires q >= 2 chars', async () => {
      const res = await t.http().get('/api/v1/search?q=town').set('Authorization', emma).expect(200);
      expect(res.body.data).toHaveLength(5);
      const bad = await t.http().get('/api/v1/search?q=a').set('Authorization', emma).expect(422);
      expect(bad.body.errors.q).toBeDefined();
    });
  });

  describe('notifications', () => {
    it('lists, marks read and marks all read', async () => {
      const list = await t.http().get('/api/v1/me/notifications').set('Authorization', max).expect(200);
      expect(list.body.meta).toMatchObject({ total: 1, unread: 1 });
      const [n] = list.body.data as { id: string; templateId: string; title: string; readAt: string | null }[];
      expect(n).toMatchObject({
        templateId: 'core.deputy_assigned',
        title: 'Priya Raman named you as deputy',
        readAt: null,
      });

      await t.http().post(`/api/v1/me/notifications/${n.id}/read`).set('Authorization', emma).expect(404); // not the owner
      await t.http().post(`/api/v1/me/notifications/${n.id}/read`).set('Authorization', max).expect(204);
      const unread = await t.http().get('/api/v1/me/notifications?unread=true').set('Authorization', max).expect(200);
      expect(unread.body.meta).toMatchObject({ total: 0, unread: 0 });
      await t.http().post('/api/v1/me/notifications/read-all').set('Authorization', max).expect(204);
    });
  });

  describe('deputies', () => {
    it('lists deputies as principal and as deputy', async () => {
      const res = await t.http().get('/api/v1/me/deputies').set('Authorization', max).expect(200);
      expect(res.body.asPrincipal).toEqual([
        expect.objectContaining({
          deputy: expect.objectContaining({ displayName: 'Sofia Site-Manager' }),
          state: 'upcoming',
          isActiveNow: false,
        }),
      ]);
      expect(res.body.asDeputy).toEqual([
        expect.objectContaining({
          principal: expect.objectContaining({ displayName: 'Priya Raman' }),
          state: 'active',
          isActiveNow: true,
        }),
      ]);
    });

    it('it_admin manages deputies of anyone; others may not pass principalId', async () => {
      const priyaId = (await t.prisma.user.findFirstOrThrow({ where: { lastName: 'Raman' } })).id;
      const created = await t
        .http()
        .post('/api/v1/me/deputies')
        .set('Authorization', ian)
        .send({
          principalId: priyaId,
          deputyId: await t.userId('emma'),
          validFrom: addDaysIso(today, 60),
          validTo: addDaysIso(today, 61),
        })
        .expect(201);
      expect(created.body.principal.id).toBe(priyaId);
      await t
        .http()
        .post('/api/v1/me/deputies')
        .set('Authorization', max)
        .send({ principalId: priyaId, deputyId: await t.userId('emma') })
        .expect(403);
      await t.http().delete(`/api/v1/me/deputies/${created.body.id}`).set('Authorization', ian).expect(204);
    });

    it('only managers and executives may name deputies (403)', async () => {
      const res = await t
        .http()
        .post('/api/v1/me/deputies')
        .set('Authorization', emma)
        .send({ deputyId: await t.userId('max') })
        .expect(403);
      expect(res.body.code).toBe('forbidden');
    });

    it('creates, rejects overlaps (409 deputy_overlap) and invalid input (422), updates and deletes', async () => {
      const emmaId = await t.userId('emma');
      const created = await t
        .http()
        .post('/api/v1/me/deputies')
        .set('Authorization', max)
        .send({
          deputyId: emmaId,
          validFrom: addDaysIso(today, 30),
          validTo: addDaysIso(today, 40),
          note: 'Trade fair',
        })
        .expect(201);
      expect(created.body).toMatchObject({ deputy: { id: emmaId }, state: 'upcoming', note: 'Trade fair' });

      const overlap = await t
        .http()
        .post('/api/v1/me/deputies')
        .set('Authorization', max)
        .send({ deputyId: emmaId, validFrom: addDaysIso(today, 35) })
        .expect(409);
      expect(overlap.body).toMatchObject({
        code: 'deputy_overlap',
        type: 'https://atrium.example.com/problems/deputy_overlap',
      });

      const invalid = await t
        .http()
        .post('/api/v1/me/deputies')
        .set('Authorization', max)
        .send({
          deputyId: await t.userId('max'),
          validFrom: addDaysIso(today, 5),
          validTo: addDaysIso(today, 1),
          bogus: 1,
        })
        .expect(422);
      expect(invalid.body.code).toBe('validation_failed');

      const updated = await t
        .http()
        .patch(`/api/v1/me/deputies/${created.body.id}`)
        .set('Authorization', max)
        .send({ validFrom: null, note: null })
        .expect(200);
      expect(updated.body).toMatchObject({ validFrom: null, note: null, state: 'active', isActiveNow: true });

      await t.http().delete(`/api/v1/me/deputies/${created.body.id}`).set('Authorization', emma).expect(404);
      await t.http().delete(`/api/v1/me/deputies/${created.body.id}`).set('Authorization', max).expect(204);

      const audit = await t.prisma.auditLog.findMany({
        where: { entityId: created.body.id },
        orderBy: { occurredAt: 'asc' },
      });
      expect(audit.map((a) => a.action)).toEqual(['create', 'update', 'delete']);
      // core.deputy_assigned: email outbox + in-app notification for the deputy
      const entity = { entityType: 'deputy', entityId: created.body.id as string };
      expect(
        await t.prisma.notification.count({ where: { userId: emmaId, templateId: 'core.deputy_assigned', ...entity } }),
      ).toBe(1);
      expect(
        await t.prisma.emailMessage.count({
          where: { templateId: 'core.deputy_assigned', to: { has: 'emma.employee@example.com' }, ...entity },
        }),
      ).toBe(1);
    });
  });

  describe('meta', () => {
    it('serves enums, config and workflow definitions from the registries', async () => {
      const enums = await t.http().get('/api/v1/meta/enums').set('Authorization', emma).expect(200);
      expect(enums.body.approverReason).toContainEqual({
        value: 'site_manager_escalation',
        label: 'Escalated past site manager',
        tone: null,
        description: null,
      });
      expect(enums.body.toyStatus[1]).toEqual({
        value: 'submitted',
        label: 'Submitted',
        tone: 'waiting',
        description: null,
      });

      const config = await t.http().get('/api/v1/meta/config').set('Authorization', emma).expect(200);
      expect(config.body).toMatchObject({
        timezone: 'Europe/Berlin',
        demoMode: true,
        trainingExecutiveThreshold: { amountCents: 500000, currency: 'EUR' },
        allowedMimeTypes: { travel_booking_confirmation: ['application/pdf'] },
        ratingReminderMax: 4,
        ratingReminderCadenceDays: 7,
        ratingOverdueDays: 14,
        assetAcceptanceDueDays: 7,
      });

      const list = await t.http().get('/api/v1/meta/workflows').set('Authorization', emma).expect(200);
      expect(list.body).toContainEqual({ name: 'toy_request', label: 'Toy request' });
      const wf = await t.http().get('/api/v1/meta/workflows/toy_request').set('Authorization', emma).expect(200);
      expect(wf.body.transitions).toHaveLength(4);
      await t.http().get('/api/v1/meta/workflows/nope').set('Authorization', emma).expect(404);
    });
  });

  describe('admin and audit (it_admin)', () => {
    it('forbids non-admins', async () => {
      await t.http().get('/api/v1/admin/users').set('Authorization', max).expect(403);
      await t.http().get('/api/v1/audit').set('Authorization', emma).expect(403);
    });

    it('lists, creates and updates users', async () => {
      const list = await t.http().get('/api/v1/admin/users?role=it_admin').set('Authorization', ian).expect(200);
      expect(list.body.data).toEqual([
        expect.objectContaining({ displayName: 'Ian IT-Admin', roles: ['it_admin'], personaKey: 'ian' }),
      ]);

      const cc = await t.prisma.costCenter.findUniqueOrThrow({ where: { code: 'CC-3100' } });
      const created = await t
        .http()
        .post('/api/v1/admin/users')
        .set('Authorization', ian)
        .send({
          email: 'new.hire@example.com',
          firstName: 'New',
          lastName: 'Hire',
          costCenterId: cc.id,
          roles: ['news_editor'],
          initialPassword: 'welcome-123',
        })
        .expect(201);
      expect(created.body).toMatchObject({
        displayName: 'New Hire',
        employeeNumber: 'E10053',
        roles: ['news_editor'],
        isManager: false,
      });
      await t
        .http()
        .post('/api/v1/admin/users')
        .set('Authorization', ian)
        .send({
          email: 'new.hire@example.com',
          firstName: 'X',
          lastName: 'Y',
          costCenterId: cc.id,
          initialPassword: 'welcome-123',
        })
        .expect(409);

      const updated = await t
        .http()
        .patch(`/api/v1/admin/users/${created.body.id}`)
        .set('Authorization', ian)
        .send({ jobTitle: 'Analyst', version: 1 })
        .expect(200);
      expect(updated.body.jobTitle).toBe('Analyst');
      const stale = await t
        .http()
        .patch(`/api/v1/admin/users/${created.body.id}`)
        .set('Authorization', ian)
        .send({ jobTitle: 'X', version: 1 })
        .expect(409);
      expect(stale.body.code).toBe('version_conflict');

      const cycle = await t
        .http()
        .patch(`/api/v1/admin/users/${await t.userId('max')}`)
        .set('Authorization', ian)
        .send({ managerId: await t.userId('emma') })
        .expect(422);
      expect(cycle.body.errors.managerId).toBeDefined();

      const login = await t
        .http()
        .post('/api/v1/auth/login')
        .send({ email: 'new.hire@example.com', password: 'welcome-123' })
        .expect(200);
      expect(login.body.user.roles).toEqual(['employee', 'news_editor']);
    });

    it('shows the audit log with summaries', async () => {
      const res = await t
        .http()
        .get('/api/v1/audit?entityType=deputy&sort=-occurredAt')
        .set('Authorization', ian)
        .expect(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(3);
      expect(res.body.data.at(-1)).toMatchObject({
        module: 'core',
        action: 'create',
        actingAs: 'self',
        summary: expect.stringContaining('created'),
      });
    });

    it('lists jobs and runs one manually (202)', async () => {
      const jobs = await t.http().get('/api/v1/admin/jobs').set('Authorization', ian).expect(200);
      expect(jobs.body.map((j: { name: string }) => j.name)).toEqual(
        expect.arrayContaining(['core.purge', 'demo.reset']),
      );
      expect(jobs.body.find((j: { name: string }) => j.name === 'core.purge')).toMatchObject({
        slice: 'F',
        cron: '10 3 * * *',
        enabled: true,
      });

      const run = await t.http().post('/api/v1/admin/jobs/core.purge/run').set('Authorization', ian).expect(202);
      let status = 'running';
      for (let i = 0; i < 40 && status === 'running'; i++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        status = (await t.prisma.jobRun.findUniqueOrThrow({ where: { id: run.body.jobRunId } })).status;
      }
      expect(status).toBe('succeeded');
      const runs = await t.http().get('/api/v1/admin/jobs/core.purge/runs').set('Authorization', ian).expect(200);
      expect(runs.body.data[0]).toMatchObject({
        triggeredBy: 'manual',
        triggeredByUser: { displayName: 'Ian IT-Admin' },
        status: 'succeeded',
      });
      await t.http().post('/api/v1/admin/jobs/nope/run').set('Authorization', ian).expect(404);
      // demo.reset is CLI/cron only (SPEC_RESOLUTIONS #29)
      await t.http().post('/api/v1/admin/jobs/demo.reset/run').set('Authorization', ian).expect(403);
    });
  });
});
