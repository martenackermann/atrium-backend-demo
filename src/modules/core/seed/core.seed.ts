import { dateFromIso } from '@/common/time/time';
import type { Seeder, SeedContext } from '@/database/seed/seed-context';
import { planCoreOrg } from './core-org.plan';

/**
 * Core seed (SPEC §10.1): 4 sites, 6 departments, 9 cost centres, 52 users (9 personas,
 * 4 named heads, 37 generated active + 2 inactive), roles and the 3 story deputies with
 * their `core.deputy_assigned` notifications. Org rows have fixed UUIDs (see core-org.plan.ts);
 * deputies are relative to SEED_TODAY. Slices seed in-app notifications for their own
 * records (SPEC_RESOLUTIONS #7).
 */
export async function seedCore(ctx: SeedContext): Promise<void> {
  const { prisma } = ctx;
  const plan = planCoreOrg(ctx.faker, ctx.uuid);

  await prisma.site.createMany({ data: plan.sites });
  await prisma.department.createMany({
    data: plan.departments.map(({ headHandle: _head, ...d }) => d),
  });
  const deptId = new Map(plan.departments.map((d) => [d.code, d.id]));
  const siteId = new Map(plan.sites.map((s) => [s.code, s.id]));
  const ccId = new Map(plan.costCenters.map((c) => [c.code, c.id]));
  await prisma.costCenter.createMany({
    data: plan.costCenters.map(({ departmentCode, ...c }) => ({ ...c, departmentId: deptId.get(departmentCode)! })),
  });

  await prisma.user.createMany({
    data: plan.users.map((u) => ({
      id: u.id,
      email: u.email,
      passwordHash: ctx.demoPasswordHash,
      firstName: u.firstName,
      lastName: u.lastName,
      displayName: u.displayName,
      jobTitle: u.jobTitle,
      employeeNumber: u.employeeNumber,
      phone: u.phone,
      departmentId: deptId.get(u.departmentCode)!,
      siteId: siteId.get(u.siteCode)!,
      costCenterId: ccId.get(u.costCenterCode)!,
      managerId: u.managerId,
      isSiteManager: u.isSiteManager,
      active: u.active,
      personaKey: u.personaKey,
      createdAt: u.createdAt,
    })),
  });
  await prisma.userRole.createMany({
    data: plan.users.flatMap((u) => u.roles.map((role) => ({ userId: u.id, role, grantedAt: u.createdAt }))),
  });

  const byHandle = new Map(plan.users.map((u) => [u.handle, u]));
  for (const d of plan.departments) {
    await prisma.department.update({ where: { id: d.id }, data: { headId: byHandle.get(d.headHandle)!.id } });
  }
  for (const u of plan.users) {
    const ref = { id: u.id, email: u.email, displayName: u.displayName, managerId: u.managerId };
    ctx.users.byEmail.set(u.email, ref);
    ctx.users.byPersona.set(u.handle, ref); // persona keys and handles (priya, victor, hilTech1, sdkAgent3...)
  }

  // Story deputies S-D1..S-D3.
  const deputies = [
    {
      principal: 'priya',
      deputy: 'max',
      from: ctx.d(-2),
      to: ctx.d(12),
      note: 'Annual leave',
      createdAt: ctx.at(-5, 10),
    },
    {
      principal: 'max',
      deputy: 'sofia',
      from: ctx.d(7),
      to: ctx.d(21),
      note: 'Conference week',
      createdAt: ctx.at(-3, 14),
    },
    { principal: 'clara', deputy: 'helen', from: null, to: null, note: null, createdAt: ctx.at(-200, 9) },
  ];
  for (const d of deputies) {
    const principal = ctx.users.get(d.principal);
    const deputy = ctx.users.get(d.deputy);
    const id = ctx.uuid(d.createdAt);
    await prisma.deputy.create({
      data: {
        id,
        principalId: principal.id,
        deputyId: deputy.id,
        validFrom: d.from ? dateFromIso(d.from) : null,
        validTo: d.to ? dateFromIso(d.to) : null,
        note: d.note,
        createdById: principal.id,
        createdAt: d.createdAt,
      },
    });
    await prisma.auditLog.create({
      data: {
        id: ctx.uuid(d.createdAt),
        occurredAt: d.createdAt,
        actorId: principal.id,
        actingAs: 'self',
        module: 'core',
        entityType: 'deputy',
        entityId: id,
        action: 'create',
        metadata: { entityLabel: `${principal.displayName} → ${deputy.displayName}`, validFrom: d.from, validTo: d.to },
        correlationId: 'seed',
      },
    });
    await prisma.notification.create({
      data: {
        id: ctx.uuid(d.createdAt),
        userId: deputy.id,
        templateId: 'core.deputy_assigned',
        module: 'core',
        title: `${principal.displayName} named you as deputy`,
        body: `You can approve training and travel requests for ${principal.displayName} ${
          d.from && d.to ? `from ${d.from} to ${d.to}` : 'permanently (no end date)'
        }.${d.note ? ` Note: ${d.note}` : ''}`,
        link: '/settings/deputies',
        priority: 'normal',
        entityType: 'deputy',
        entityId: id,
        readAt: d.principal === 'clara' ? ctx.at(-199, 9) : null,
        createdAt: d.createdAt,
      },
    });
  }

  ctx.log(`core: ${plan.users.length} users, ${plan.sites.length} sites, ${plan.departments.length} departments`);
}

export const seeder: Seeder = { name: 'org, users, personas, deputies', run: seedCore };
