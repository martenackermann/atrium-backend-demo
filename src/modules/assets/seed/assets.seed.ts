import { en, Faker } from '@faker-js/faker';
import type { ActingAs } from '@/common/domain/vocabulary';
import { dateFromIso, isoDateInZone } from '@/common/time/time';
import { seededUuidFactory } from '@/database/seed/run-seed';
import type { Seeder, SeedContext } from '@/database/seed/seed-context';
import type { Prisma } from '@/generated/prisma/client';
import type { NotificationTemplate } from '@/modules/core/notifications/notification-template';
import { acceptanceDueDate, assetTag, costCenterLabel, deviceNoun } from '../assets.domain';
import { ASSET_AUDIT_LABELS } from '../assets.enums';
import { acceptanceReminderNotification } from '../mail/acceptance-reminder.notification';
import { assignmentPendingNotification } from '../mail/assignment-pending.notification';
import { returnedNotification } from '../mail/returned.notification';
import { SEED_DEVICE_TYPES, SEED_MANUFACTURERS, SEED_MODELS, SEED_PLATFORMS } from './assets-catalog.plan';
import { planAssets, type SeedAssetSpec, type SeedEvent } from './assets-story.plan';

type Status = 'in_stock' | 'pending_acceptance' | 'in_use' | 'in_repair' | 'scrapped';

/** Local time of day per event type (hh, mm); per-asset minute jitter is added. */
const TIME_OF_DAY: Record<SeedEvent['t'], [number, number]> = {
  create: [9, 5],
  assign: [10, 15],
  accept: [14, 30],
  decline: [11, 40],
  unassign: [16, 0],
  return: [13, 20],
  send_to_repair: [14, 5],
  complete_repair: [11, 10],
  scrap: [12, 0],
  delete: [12, 30],
  update: [16, 40],
  cost_center_sync: [2, 0],
  remind: [7, 40],
};

const DEFAULT_ADMIN = 'arne';

interface OpenAssignment {
  id: string;
  userId: string;
  assignedById: string;
  assignedAt: Date;
  note: string | null;
  acceptedAt: Date | null;
  lastRemindedAt: Date | null;
  reminderCount: number;
}

/**
 * Seeds SPEC §10.4: the catalogue (7 device types, 8 manufacturers, 6 platforms, 25 models) and
 * 120 assets replayed from event histories (assets-story.plan.ts) with assignments, audit rows
 * (field diffs, cost-centre syncs, reminders) and the in-app notifications of the story records.
 * Uses its own faker instance so the output does not depend on other modules' seeds.
 */
export async function seedAssets(ctx: SeedContext): Promise<void> {
  const { prisma, env } = ctx;
  const zone = env.APP_TIMEZONE;
  const faker = new Faker({ locale: [en] });
  faker.seed(env.SEED_FAKER_SEED + 3);
  const uuid = seededUuidFactory(faker);
  const userIdOf = (handle: string) => ctx.users.get(handle).id;
  const nameOf = (handle: string) => ctx.users.get(handle).displayName;

  const users = await prisma.user.findMany({ include: { costCenter: true, roles: true } });
  const userById = new Map(users.map((u) => [u.id, u]));
  const costCenters = await prisma.costCenter.findMany();
  const ccByCode = new Map(costCenters.map((c) => [c.code, c]));
  const defaultCc = ccByCode.get(env.DEFAULT_COST_CENTER_CODE);
  if (!defaultCc) throw new Error(`Default cost centre ${env.DEFAULT_COST_CENTER_CODE} missing`);

  const actingAsOf = (userId: string): ActingAs => {
    const roles = userById.get(userId)?.roles.map((r) => r.role) ?? [];
    if (roles.includes('it_admin')) return 'admin';
    if (roles.includes('asset_admin')) return 'back_office';
    return 'self';
  };

  const audit: Prisma.AuditLogCreateManyInput[] = [];
  const notifications: Prisma.NotificationCreateManyInput[] = [];
  const catalogAt = ctx.at(-900, 9);
  const arne = userIdOf(DEFAULT_ADMIN);
  const catalogAudit = (entityType: string, entityId: string, label: string, action = 'create', at = catalogAt) =>
    audit.push({
      id: uuid(at),
      occurredAt: at,
      actorId: arne,
      actingAs: 'back_office',
      module: 'assets',
      entityType,
      entityId,
      action,
      metadata: { entityLabel: label },
      correlationId: 'seed',
    });

  // --- catalogue --------------------------------------------------------------------------
  const typeId = new Map<string, string>();
  const typeName = new Map<string, string>();
  for (const t of SEED_DEVICE_TYPES) {
    const id = uuid(catalogAt);
    typeId.set(t.code, id);
    typeName.set(t.code, t.name);
    await prisma.deviceType.create({ data: { id, ...t, createdAt: catalogAt } });
    catalogAudit('device_type', id, t.name);
  }
  const manufacturerId = new Map<string, string>();
  const serialPrefix = new Map<string, string>();
  for (const m of SEED_MANUFACTURERS) {
    const id = uuid(catalogAt);
    manufacturerId.set(m.name, id);
    serialPrefix.set(m.name, m.serialPrefix);
    await prisma.manufacturer.create({
      data: {
        id,
        name: m.name,
        createdAt: catalogAt,
        deviceTypes: { create: m.types.map((code) => ({ deviceTypeId: typeId.get(code)! })) },
      },
    });
    catalogAudit('manufacturer', id, m.name);
  }
  const platformId = new Map<string, string>();
  for (const p of SEED_PLATFORMS) {
    const id = uuid(catalogAt);
    platformId.set(p.name, id);
    const archivedAt = p.archived ? ctx.at(-150, 11) : null;
    await prisma.platform.create({
      data: {
        id,
        name: p.name,
        archivedAt,
        createdAt: catalogAt,
        deviceTypes: { create: p.types.map((code) => ({ deviceTypeId: typeId.get(code)! })) },
      },
    });
    catalogAudit('platform', id, p.name);
    if (archivedAt) catalogAudit('platform', id, p.name, 'archive', archivedAt);
  }
  const modelByName = new Map<string, { id: string; type: string; manufacturer: string; platform?: string }>();
  for (const m of SEED_MODELS) {
    const id = uuid(catalogAt);
    modelByName.set(m.name, { id, type: m.type, manufacturer: m.manufacturer, platform: m.platform });
    const archivedAt = m.archived ? ctx.at(-200, 11) : null;
    await prisma.assetModel.create({
      data: {
        id,
        name: m.name,
        manufacturerId: manufacturerId.get(m.manufacturer)!,
        deviceTypeId: typeId.get(m.type)!,
        storageGb: m.storageGb ?? null,
        color: m.color ?? null,
        archivedAt,
        createdById: arne,
        createdAt: catalogAt,
      },
    });
    catalogAudit('asset_model', id, m.name);
    if (archivedAt) catalogAudit('asset_model', id, m.name, 'archive', archivedAt);
  }

  // --- asset numbers: story records fixed, the rest by purchase date --------------------------
  const specs = planAssets((min, max) => faker.number.int({ min, max }));
  const reserved = new Set(specs.flatMap((s) => (s.number ? [s.number] : [])));
  const createDay = (s: SeedAssetSpec) => s.events[0].day;
  const byAge = specs
    .map((spec, index) => ({ spec, index }))
    .filter(({ spec }) => !spec.number)
    .sort((a, b) => createDay(a.spec) - createDay(b.spec) || a.index - b.index);
  const numberOf = new Map<SeedAssetSpec, number>(specs.filter((s) => s.number).map((s) => [s, s.number!]));
  let next = 1;
  for (const { spec } of byAge) {
    while (reserved.has(next)) next++;
    numberOf.set(spec, next++);
  }

  const isWeekend = (offset: number) => {
    const day = dateFromIso(ctx.d(offset)).getUTCDay();
    return day === 0 || day === 6;
  };
  /** Reminder jobs run on weekdays only: move forward to a weekday, never past today. */
  const weekday = (offset: number) => {
    let o = offset;
    while (isWeekend(o)) o++;
    if (o > 0) {
      o = offset;
      while (isWeekend(o)) o--;
    }
    return o;
  };

  // --- replay ---------------------------------------------------------------------------------------
  const assetRows: Prisma.AssetCreateManyInput[] = [];
  const assignmentRows: Prisma.AssetAssignmentCreateManyInput[] = [];
  const usedSerials = new Set<string>();
  const counts = { status: {} as Record<string, number>, type: {} as Record<string, number> };

  specs.forEach((spec, index) => {
    const model = modelByName.get(spec.model);
    if (!model) throw new Error(`Seed model "${spec.model}" missing`);
    const number = numberOf.get(spec)!;
    const tag = assetTag(number);
    const label = `${tag} · ${spec.model}`;
    const jitter = (index * 7) % 50;
    const when = (e: SeedEvent) => {
      const [hh, mm] = TIME_OF_DAY[e.t];
      if (e.t === 'remind') return ctx.at(weekday(e.day), hh, mm + (index % 5));
      if (e.t === 'cost_center_sync') return ctx.at(e.day, hh, index % 10);
      return ctx.at(e.day, hh, mm + jitter);
    };

    let serial: string;
    do {
      serial = `${serialPrefix.get(model.manufacturer)}${faker.string.alphanumeric({ length: 7, casing: 'upper' })}`;
    } while (usedSerials.has(serial));
    usedSerials.add(serial);
    const fixesTypo = spec.events.some((e) => e.t === 'update' && e.set.serialNumber === 'fix_typo');
    const typo = `${serial.slice(0, -2)}${serial.at(-1)}${serial.at(-2)}`;

    const created = spec.events[0];
    if (created.t !== 'create') throw new Error(`${label}: the first event must be create`);
    const createdAt = when(created);
    const assetId = uuid(createdAt);
    const requiresPlatform = SEED_DEVICE_TYPES.find((t) => t.code === model.type)!.requiresPlatform;
    const prefix = model.type === 'laptop' ? 'LT' : model.type === 'desktop' ? 'DT' : null;

    const state = {
      status: 'in_stock' as Status,
      serialNumber: fixesTypo && typo !== serial ? typo : serial,
      name: prefix ? `${prefix}-${String(number).padStart(4, '0')}` : (null as string | null),
      notes: null as string | null,
      platformId: null as string | null,
      costCenterId: defaultCc.id,
      assignedUserId: null as string | null,
      updatedAt: createdAt,
      updatedById: userIdOf(created.by ?? DEFAULT_ADMIN) as string | null,
      deletedAt: null as Date | null,
      deletedById: null as string | null,
      version: 1,
    };
    let open: OpenAssignment | null = null;

    const record = (
      e: SeedEvent,
      at: Date,
      actorId: string | null,
      from: Status | null,
      extra: { reason?: string | null; changes?: Prisma.InputJsonValue; metadata?: Record<string, unknown> } = {},
    ) =>
      audit.push({
        id: uuid(at),
        occurredAt: at,
        actorId,
        actingAs: actorId ? actingAsOf(actorId) : 'system',
        module: 'assets',
        entityType: 'asset',
        entityId: assetId,
        action: e.t,
        fromState: from,
        toState: e.t === 'update' || e.t === 'cost_center_sync' || e.t === 'remind' ? null : state.status,
        correlationId: 'seed',
        reason: extra.reason ?? null,
        changes: extra.changes,
        metadata: { entityLabel: label, ...extra.metadata },
      });
    const close = (data: Partial<Prisma.AssetAssignmentCreateManyInput>) => {
      if (!open) return;
      assignmentRows.push({ ...openRow(open, assetId), ...data });
      open = null;
      state.assignedUserId = null;
      state.costCenterId = defaultCc.id;
    };
    const touch = (at: Date, actorId: string | null) => {
      state.updatedAt = at;
      if (actorId) state.updatedById = actorId;
      state.version++;
    };

    record(created, createdAt, state.updatedById, null);
    for (const e of spec.events.slice(1)) {
      const at = when(e);
      const from = state.status;
      const adminId = 'by' in e && e.by ? userIdOf(e.by) : userIdOf(DEFAULT_ADMIN);
      switch (e.t) {
        case 'assign': {
          const userId = userIdOf(e.to);
          open = {
            id: uuid(at),
            userId,
            assignedById: adminId,
            assignedAt: at,
            note: e.note ?? null,
            acceptedAt: null,
            lastRemindedAt: null,
            reminderCount: 0,
          };
          state.status = 'pending_acceptance';
          state.assignedUserId = userId;
          touch(at, adminId);
          record(e, at, adminId, from, { reason: e.note ?? null });
          break;
        }
        case 'accept': {
          if (!open) throw new Error(`${label}: accept without assignment`);
          const holder = userById.get(open.userId)!;
          open.acceptedAt = at;
          state.status = 'in_use';
          state.costCenterId = e.cc ? ccByCode.get(e.cc)!.id : holder.costCenterId;
          if (requiresPlatform) state.platformId = platformId.get(model.platform!)!;
          touch(at, holder.id);
          record(e, at, holder.id, from);
          break;
        }
        case 'decline': {
          const userId = open?.userId ?? null;
          state.status = 'in_stock';
          close({ declinedAt: at, declineReason: e.reason });
          touch(at, userId);
          record(e, at, userId, from, { reason: e.reason });
          break;
        }
        case 'unassign':
          state.status = 'in_stock';
          close({ unassignedAt: at });
          touch(at, adminId);
          record(e, at, adminId, from, { reason: e.reason ?? null });
          break;
        case 'return':
          state.status = e.condition === 'damaged' ? 'in_repair' : 'in_stock';
          close({ returnedAt: at, returnCondition: e.condition, returnNote: e.note ?? null });
          touch(at, adminId);
          record(e, at, adminId, from, { reason: e.note ?? null });
          break;
        case 'send_to_repair':
          state.status = 'in_repair';
          touch(at, adminId);
          record(e, at, adminId, from, { reason: e.note });
          break;
        case 'complete_repair':
          state.status = open?.acceptedAt ? 'in_use' : 'in_stock';
          touch(at, adminId);
          record(e, at, adminId, from, { reason: e.note ?? null });
          break;
        case 'scrap':
          state.status = 'scrapped';
          close({ returnedAt: at });
          touch(at, adminId);
          record(e, at, adminId, from, { reason: e.reason });
          break;
        case 'delete':
          state.deletedAt = at;
          state.deletedById = adminId;
          touch(at, adminId);
          record(e, at, adminId, from);
          break;
        case 'update': {
          const fields = ASSET_AUDIT_LABELS.asset.fields!;
          const changes: { field: string; label: string; from: unknown; to: unknown }[] = [];
          if (e.set.serialNumber === 'fix_typo' && state.serialNumber !== serial) {
            changes.push({ field: 'serialNumber', label: fields.serialNumber, from: state.serialNumber, to: serial });
            state.serialNumber = serial;
          }
          if (e.set.notes !== undefined) {
            changes.push({ field: 'notes', label: fields.notes, from: state.notes, to: e.set.notes });
            state.notes = e.set.notes;
          }
          if (e.set.name !== undefined) {
            changes.push({ field: 'name', label: fields.name, from: state.name, to: e.set.name });
            state.name = e.set.name;
          }
          if (!changes.length) break;
          touch(at, adminId);
          record(e, at, adminId, null, { changes: changes as Prisma.InputJsonValue });
          break;
        }
        case 'cost_center_sync': {
          const fromCc = costCenters.find((c) => c.id === state.costCenterId)!;
          const toCc = ccByCode.get(e.to)!;
          state.costCenterId = toCc.id;
          touch(at, null);
          record(e, at, null, null, {
            changes: [
              { field: 'costCenter', label: 'Cost centre', from: costCenterLabel(fromCc), to: costCenterLabel(toCc) },
            ],
            metadata: { userId: state.assignedUserId },
          });
          break;
        }
        case 'remind': {
          if (!open) throw new Error(`${label}: reminder without assignment`);
          open.reminderCount++;
          open.lastRemindedAt = at;
          record(e, at, null, null, { metadata: { reminder: open.reminderCount, userId: open.userId } });
          break;
        }
        case 'create':
          throw new Error(`${label}: duplicate create`);
      }
    }
    if (open) assignmentRows.push(openRow(open, assetId));

    // A user's current cost centre wins for accepted devices (what the nightly sync guarantees).
    assetRows.push({
      id: assetId,
      number,
      serialNumber: state.serialNumber,
      name: state.name,
      modelId: model.id,
      platformId: state.platformId,
      status: state.status,
      assignedUserId: state.assignedUserId,
      costCenterId: state.costCenterId,
      purchaseDate: dateFromIso(ctx.d(created.day)),
      mdmEnrolled: requiresPlatform,
      notes: state.notes,
      createdById: userIdOf(created.by ?? DEFAULT_ADMIN),
      updatedById: state.updatedById,
      deletedAt: state.deletedAt,
      deletedById: state.deletedById,
      version: state.version,
      createdAt,
      updatedAt: state.updatedAt,
    });
    counts.status[state.status] = (counts.status[state.status] ?? 0) + 1;
    counts.type[model.type] = (counts.type[model.type] ?? 0) + 1;
  });

  assertCounts(counts, assetRows.length);
  await prisma.asset.createMany({ data: assetRows });
  await prisma.assetAssignment.createMany({ data: assignmentRows });
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('assets', 'number'), (SELECT COALESCE(MAX(number), 1) FROM assets))`,
  );

  // --- in-app notifications of the story records (SPEC_RESOLUTIONS #7) --------------------------
  const assetById = new Map(assetRows.map((a) => [a.id!, a]));
  const modelNameById = new Map([...modelByName.entries()].map(([name, m]) => [m.id, { name, type: m.type }]));
  const notify = <T extends object>(
    template: NotificationTemplate<T>,
    userId: string,
    context: T,
    createdAt: Date,
    readAt: Date | null,
    entityId: string,
    priority: 'high' | 'normal' = 'normal',
  ) =>
    notifications.push({
      id: uuid(createdAt),
      userId,
      templateId: template.id,
      module: 'assets',
      title: template.title?.(context) ?? template.subject(context),
      body: template.body(context),
      link: template.link?.(context) ?? null,
      priority,
      entityType: 'asset',
      entityId,
      readAt,
      createdAt,
    });
  const later = (at: Date, hours: number) => new Date(at.getTime() + hours * 3_600_000);
  const unreadFor = new Set(['emma', 'sdkAgent5'].map(userIdOf));

  const pendingContext = (a: Prisma.AssetAssignmentCreateManyInput) => {
    const asset = assetById.get(a.assetId)!;
    const model = modelNameById.get(asset.modelId)!;
    return {
      userName: userById.get(a.userId)!.displayName,
      deviceType: deviceNoun(typeName.get(model.type)!),
      model: model.name,
      assetTag: assetTag(asset.number!),
      serialNumber: asset.serialNumber,
      assignedBy: userById.get(a.assignedById)!.displayName,
      note: a.note ?? null,
      dueDate: acceptanceDueDate(a.assignedAt as Date, env.ASSET_ACCEPTANCE_DUE_DAYS, zone),
      assetId: asset.id!,
    };
  };

  // Devices waiting for acceptance: the assignment mail and every reminder.
  const remindersByAsset = new Map<string, Date[]>();
  for (const row of audit) {
    if (row.action !== 'remind') continue;
    const list = remindersByAsset.get(row.entityId) ?? [];
    list.push(row.occurredAt as Date);
    remindersByAsset.set(row.entityId, list);
  }
  for (const a of assignmentRows) {
    const asset = assetById.get(a.assetId)!;
    if (asset.status !== 'pending_acceptance' || a.declinedAt || a.unassignedAt || a.returnedAt) continue;
    const ctxPending = pendingContext(a);
    const assignedAt = a.assignedAt as Date;
    const recentAssignment = assignedAt.getTime() > ctx.at(-2, 0).getTime();
    notify(
      assignmentPendingNotification,
      a.userId,
      ctxPending,
      assignedAt,
      unreadFor.has(a.userId) && recentAssignment ? null : later(assignedAt, 5),
      asset.id!,
    );
    const reminders = remindersByAsset.get(asset.id!) ?? [];
    reminders.forEach((at, i) => {
      const reminder = i + 1;
      notify(
        acceptanceReminderNotification,
        a.userId,
        {
          userName: ctxPending.userName,
          deviceType: ctxPending.deviceType,
          model: ctxPending.model,
          assetTag: ctxPending.assetTag,
          assignedOn: isoDateInZone(assignedAt, zone),
          reminder,
          reminderMax: env.ASSET_ACCEPTANCE_REMINDER_MAX,
          assetId: asset.id!,
        },
        at,
        i === reminders.length - 1 ? null : later(at, 3),
        asset.id!,
        reminder >= 2 ? 'high' : 'normal',
      );
    });
  }
  // Each other persona: the mail of their most recently assigned device (read).
  for (const persona of ['max', 'sofia', 'clara', 'tom', 'tina', 'arne', 'paula', 'ian']) {
    const userId = userIdOf(persona);
    const latest = assignmentRows
      .filter((a) => a.userId === userId && a.acceptedAt)
      .sort((x, y) => (y.assignedAt as Date).getTime() - (x.assignedAt as Date).getTime())[0];
    if (!latest) continue;
    notify(
      assignmentPendingNotification,
      userId,
      pendingContext(latest),
      latest.assignedAt as Date,
      latest.acceptedAt as Date,
      latest.assetId,
    );
  }
  // Recent returns by active users.
  for (const a of assignmentRows) {
    const returnedAt = a.returnedAt as Date | null | undefined;
    if (!returnedAt || !a.returnCondition || returnedAt.getTime() < ctx.at(-30, 0).getTime()) continue;
    const holder = userById.get(a.userId)!;
    if (!holder.active) continue;
    const asset = assetById.get(a.assetId)!;
    notify(
      returnedNotification,
      holder.id,
      {
        userName: holder.displayName,
        assetTag: assetTag(asset.number!),
        model: modelNameById.get(asset.modelId)!.name,
        condition: a.returnCondition,
        note: a.returnNote ?? null,
      },
      returnedAt,
      returnedAt.getTime() < ctx.at(-14, 0).getTime() ? later(returnedAt, 20) : null,
      asset.id!,
    );
  }

  await prisma.auditLog.createMany({ data: audit });
  await prisma.notification.createMany({ data: notifications });
  ctx.log(
    `assets: ${assetRows.length} assets, ${SEED_MODELS.length} models, ${assignmentRows.length} assignments, ` +
      `${audit.length} audit rows, ${notifications.length} notifications (S-A1 ${nameOf('emma')})`,
  );
}

function openRow(open: OpenAssignment, assetId: string): Prisma.AssetAssignmentCreateManyInput {
  return {
    id: open.id,
    assetId,
    userId: open.userId,
    assignedById: open.assignedById,
    assignedAt: open.assignedAt,
    note: open.note,
    acceptedAt: open.acceptedAt,
    lastRemindedAt: open.lastRemindedAt,
    reminderCount: open.reminderCount,
    createdAt: open.assignedAt,
    updatedAt: open.lastRemindedAt ?? open.acceptedAt ?? open.assignedAt,
  };
}

const EXPECTED_STATUS: Record<Status, number> = {
  in_use: 82,
  pending_acceptance: 4,
  in_stock: 22,
  in_repair: 5,
  scrapped: 7,
};
const EXPECTED_TYPE: Record<string, number> = {
  laptop: 40,
  monitor: 30,
  smartphone: 22,
  desktop: 8,
  tablet: 8,
  headset: 8,
  dock: 4,
};

/** Guards the SPEC §10.4 distribution so plan edits cannot drift silently. */
function assertCounts(counts: { status: Record<string, number>; type: Record<string, number> }, total: number) {
  const problems: string[] = [];
  if (total !== 120) problems.push(`total ${total} (expected 120)`);
  for (const [status, n] of Object.entries(EXPECTED_STATUS)) {
    if ((counts.status[status] ?? 0) !== n) problems.push(`${status} ${counts.status[status] ?? 0} (expected ${n})`);
  }
  for (const [type, n] of Object.entries(EXPECTED_TYPE)) {
    if ((counts.type[type] ?? 0) !== n) problems.push(`${type} ${counts.type[type] ?? 0} (expected ${n})`);
  }
  if (problems.length) throw new Error(`Asset seed distribution is off: ${problems.join(', ')}`);
}

export const seeder: Seeder = { name: 'asset catalogue, 120 assets, assignments', run: seedAssets };
