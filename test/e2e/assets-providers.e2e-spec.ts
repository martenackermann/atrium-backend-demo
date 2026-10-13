import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Clock } from '@/common/time/clock.service';
import { addDaysIso, isoDateInZone } from '@/common/time/time';
import { AssetsJobs } from '@/modules/assets/jobs/assets.jobs';
import type { AuthUser } from '@/common/auth/auth-user';
import { InboxService } from '@/modules/core/inbox/inbox.service';
import { createTestApp, type TestApp } from '../support/test-app';

/** Inbox / search / my-day providers (API.md §3.5, §7.4, §8) and the SPEC §8 jobs. */
describe('assets: providers and jobs', () => {
  let t: TestApp;
  let emma: string;
  let arne: string;
  let ian: string;
  let clock: Clock;
  let jobs: AssetsJobs;

  const runContext = (now: Date) => ({
    runId: 'test',
    triggeredBy: 'manual' as const,
    triggeredById: null,
    now,
    today: isoDateInZone(now, clock.timeZone),
  });
  const authUser = async (persona: string): Promise<AuthUser> => {
    const user = await t.prisma.user.findFirstOrThrow({ where: { personaKey: persona } });
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: ['employee'],
      isSiteManager: false,
      sessionId: null,
    };
  };

  beforeAll(async () => {
    t = await createTestApp({ seed: ['core', 'assets'] });
    [emma, arne, ian] = await Promise.all([t.login('emma'), t.login('arne'), t.login('ian')]);
    clock = t.app.get(Clock);
    jobs = t.app.get(AssetsJobs);
  });

  afterEach(() => clock.set(null));

  afterAll(async () => {
    await t?.close();
  });

  describe('inbox (assets.acceptance_required)', () => {
    it("lists Emma's two devices with the due date rule of SPEC_RESOLUTIONS #23", async () => {
      const res = await t.http().get('/api/v1/me/inbox?module=assets').set('Authorization', emma).expect(200);
      expect(res.body.meta.byModule.assets).toBe(2);
      const items = res.body.data as { reference: string; dueAt: string; createdAt: string }[];
      expect(items.map((i) => i.reference).sort()).toEqual(['AST-00115', 'AST-00118']);
      const laptop = res.body.data.find((i: { reference: string }) => i.reference === 'AST-00118');
      expect(laptop).toMatchObject({
        module: 'assets',
        type: 'assets.acceptance_required',
        title: 'Confirm your new laptop',
        subtitle: 'Vireo Pro 14 · AST-00118',
        priority: 'normal',
        actingAs: null,
        actionsPath: null,
        quickActions: [],
      });
      expect(laptop.id).toBe(`assets.acceptance_required:${laptop.entityId}`);
      expect(laptop.link).toBe(`/assets/${laptop.entityId}`);
      const assignedDay = isoDateInZone(new Date(laptop.createdAt), clock.timeZone);
      const due = await t.prisma.$queryRaw<{ due: Date }[]>`
        SELECT (${addDaysIso(assignedDay, 7)}::date::timestamp AT TIME ZONE ${clock.timeZone}) AS due`;
      expect(laptop.dueAt).toBe(due[0].due.toISOString());
    });

    it('marks the overdue Hillford tablet high priority (3 reminders) and gives back offices no items', async () => {
      const tablet = await t.prisma.asset.findFirstOrThrow({
        where: { status: 'pending_acceptance', model: { deviceType: { code: 'tablet' } } },
        include: { assignedUser: true, assignments: true },
      });
      const holder = await t.prisma.user.findUniqueOrThrow({ where: { id: tablet.assignedUserId! } });
      const user: AuthUser = {
        id: holder.id,
        email: holder.email,
        displayName: holder.displayName,
        roles: ['employee'],
        isSiteManager: false,
        sessionId: null,
      };
      const inbox = await t.app.get(InboxService).inbox(user, { modules: ['assets'] });
      expect(inbox.data).toHaveLength(1);
      expect(inbox.data[0].priority).toBe('high');
      expect(new Date(inbox.data[0].dueAt!).getTime()).toBeLessThan(Date.now());
      for (const auth of [arne, ian]) {
        const res = await t.http().get('/api/v1/me/inbox?module=assets').set('Authorization', auth).expect(200);
        expect(res.body.data).toEqual([]);
      }
    });
  });

  describe('search and my day', () => {
    it('finds assets by exact tag or serial: admins see all, users their own', async () => {
      const max = await t.prisma.asset.findFirstOrThrow({
        where: { assignedUser: { personaKey: 'max' }, status: 'in_repair' },
      });
      const tag = `AST-${String(max.number).padStart(5, '0')}`;
      let res = await t.http().get(`/api/v1/search?q=${tag.toLowerCase()}`).set('Authorization', arne).expect(200);
      const hit = res.body.data.find((h: { module: string }) => h.module === 'assets');
      expect(hit).toMatchObject({
        type: 'asset',
        id: max.id,
        reference: tag,
        link: `/back-office/assets/inventory/${max.id}`,
      });
      res = await t.http().get(`/api/v1/search?q=${tag}`).set('Authorization', emma).expect(200);
      expect(res.body.data.filter((h: { module: string }) => h.module === 'assets')).toEqual([]);
      const own = await t.prisma.asset.findUniqueOrThrow({ where: { number: 64 } });
      res = await t
        .http()
        .get(`/api/v1/search?q=${own.serialNumber.slice(0, 6)}`)
        .set('Authorization', emma)
        .expect(200);
      expect(res.body.data.find((h: { id: string }) => h.id === own.id)).toMatchObject({ link: `/assets/${own.id}` });
    });

    it('contributes device counts to My day', async () => {
      const day = await t.app.get(InboxService).myDay(await authUser('emma'));
      expect(day.assets).toEqual({ active: 2, pendingAcceptance: 2 });
      const maxDay = await t.app.get(InboxService).myDay(await authUser('max'));
      expect(maxDay.assets).toEqual({ active: 3, pendingAcceptance: 0 });
    });
  });

  describe('jobs (SPEC §8)', () => {
    it('acceptance reminders: cadence, max count, high priority from the 2nd reminder, idempotent', async () => {
      // Today: S-A2 was reminded yesterday, S-A1 and the headset are too new, the tablet is at the max.
      let summary = await jobs.acceptanceReminders(runContext(new Date()));
      expect(summary).toEqual({ reminded: 0, skippedMax: 1 });

      const in3Days = new Date(Date.now() + 3 * 86_400_000);
      clock.set(in3Days);
      summary = await jobs.acceptanceReminders(runContext(in3Days));
      expect(summary).toEqual({ reminded: 3, skippedMax: 1 });
      const phone = await t.prisma.asset.findUniqueOrThrow({ where: { number: 115 }, include: { assignments: true } });
      expect(phone.assignments[0]).toMatchObject({ reminderCount: 2 });
      const emmaId = await t.userId('emma');
      const reminders = await t.prisma.notification.findMany({
        where: { userId: emmaId, templateId: 'assets.acceptance_reminder', entityId: phone.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(reminders[0]).toMatchObject({ priority: 'high', title: 'Reminder: confirm your smartphone' });
      const mail = await t.prisma.emailMessage.findFirstOrThrow({
        where: { templateId: 'assets.acceptance_reminder', entityId: phone.id },
      });
      expect(mail.subject).toBe('[High priority] Reminder: confirm your smartphone');
      const audit = await t.prisma.auditLog.findFirstOrThrow({
        where: { entityId: phone.id, action: 'remind' },
        orderBy: { occurredAt: 'desc' },
      });
      expect(audit).toMatchObject({ actorId: null, actingAs: 'system' });

      summary = await jobs.acceptanceReminders(runContext(in3Days));
      expect(summary).toEqual({ reminded: 0, skippedMax: 1 });
    });

    it("cost-centre sync: follows the user's cost centre for accepted devices only, with a diff", async () => {
      const emmaId = await t.userId('emma');
      const cc = await t.prisma.costCenter.findUniqueOrThrow({ where: { code: 'CC-2300' } });
      await t.prisma.user.update({ where: { id: emmaId }, data: { costCenterId: cc.id } });
      let summary = await jobs.costCenterSync(runContext(new Date()));
      expect(summary.updated).toBe(2);
      const emmasAssets = await t.prisma.asset.findMany({
        where: { assignedUserId: emmaId },
        include: { costCenter: true },
      });
      for (const asset of emmasAssets) {
        expect(asset.costCenter.code).toBe(asset.status === 'pending_acceptance' ? 'CC-4900' : 'CC-2300');
      }
      const audit = await t.prisma.auditLog.findFirstOrThrow({
        where: { action: 'cost_center_sync', entityId: emmasAssets.find((a) => a.status === 'in_use')!.id },
        orderBy: { occurredAt: 'desc' },
      });
      expect(audit.changes).toEqual([
        {
          field: 'costCenter',
          label: 'Cost centre',
          from: 'CC-2100 Field Services Riverton',
          to: 'CC-2300 Field Services Eastgate',
        },
      ]);
      summary = await jobs.costCenterSync(runContext(new Date()));
      expect(summary.updated).toBe(0);
    });

    it('registers both jobs for the job runner (reminders are off in demo mode)', async () => {
      const res = await t.http().get('/api/v1/admin/jobs').set('Authorization', ian).expect(200);
      const mine = res.body.filter((j: { slice: string }) => j.slice === 'A3');
      expect(mine.map((j: { name: string; enabled: boolean }) => [j.name, j.enabled])).toEqual([
        ['assets.acceptance-reminders', false],
        ['assets.cost-center-sync', true],
      ]);
    });
  });
});
