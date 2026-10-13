import { dateFromIso } from '@/common/time/time';
import type { SeedContext, Seeder } from '@/database/seed/seed-context';
import type { Prisma } from '@/generated/prisma/client';
import { peopleReference, shortDate, STATUS_LABELS, TYPE_LABELS, type PeopleRequestStatus } from '../people.constants';
import { type At, JOB_ROLES, PEOPLE_STORY, type StoryEvent } from './people.story';

/** Machine targets of the seeded history events (SPEC §5.4). */
const TARGET: Record<StoryEvent['action'], PeopleRequestStatus> = {
  start_work: 'in_progress',
  wait_internal: 'waiting_internal',
  wait_on_requester: 'waiting_on_requester',
  resume: 'in_progress',
  complete: 'completed',
  reject: 'rejected',
  cancel: 'cancelled',
  reopen: 'reopened',
};

const STATUS_TEXT: Partial<Record<PeopleRequestStatus, string>> = {
  in_progress: 'People Ops is working on it.',
  waiting_internal: 'People Ops is waiting on another team. You will hear from us when it moves on.',
  waiting_on_requester: 'People Ops needs your reply before they can continue.',
  reopened: 'The request was reopened.',
  completed: 'The request is complete.',
  rejected: 'The request was rejected.',
  cancelled: 'The request was cancelled.',
};

const PEOPLE_OPS_HANDLES = new Set(['paula', 'ppl3']);

async function seedPeople(ctx: SeedContext): Promise<void> {
  const { prisma } = ctx;
  const at = ([day, hour, minute]: At) => ctx.at(day, hour, minute);
  const user = (handle: string) => ctx.users.get(handle);

  // Job-role catalogue (SPEC §4.5).
  const roleIds = new Map<string, string>();
  for (const [index, role] of JOB_ROLES.entries()) {
    const createdAt = new Date(Date.UTC(2024, 0, 10, 8, 0, index));
    const id = ctx.uuid(createdAt);
    await prisma.jobRole.create({ data: { id, name: role.name, category: role.category, createdAt } });
    roleIds.set(role.name, id);
  }

  const departments = new Map((await prisma.department.findMany()).map((d) => [d.code, d.id]));
  const sites = new Map((await prisma.site.findMany()).map((s) => [s.code, s.id]));
  const subjects = await prisma.user.findMany({
    where: { id: { in: PEOPLE_STORY.filter((s) => s.subject).map((s) => user(s.subject!).id) } },
  });

  let notifications = 0;
  for (const story of PEOPLE_STORY) {
    const requester = user(story.requester);
    const subject = story.subject ? subjects.find((u) => u.id === user(story.subject!).id) : undefined;
    const managerId = story.manager ? user(story.manager).id : (subject?.managerId ?? null);
    const createdAt = at(story.createdAt);
    const id = ctx.uuid(createdAt);
    const reference = peopleReference(story.number);
    const finalEvent = story.history.at(-1);
    const status: PeopleRequestStatus = finalEvent ? TARGET[finalEvent.action] : 'open';
    const closing = [...story.history].reverse().find((e) => ['complete', 'reject', 'cancel'].includes(e.action));
    const lastReason = [...story.history].reverse().find((e) => e.reason)?.reason ?? null;
    const assigneeHandle = story.history.find((e) => e.action === 'start_work')?.by;
    const lastActivity = [story.createdAt, ...story.history.map((e) => e.at), ...story.comments.map((c) => c.at)]
      .map(at)
      .reduce((a, b) => (a > b ? a : b));
    const pd = story.personalData;

    const data: Prisma.PeopleRequestUncheckedCreateInput = {
      id,
      number: story.number,
      type: story.type,
      title: story.title,
      priority: story.priority,
      status,
      jobRoleId: story.jobRole ? roleIds.get(story.jobRole)! : null,
      subjectUserId: subject?.id ?? null,
      salutation: story.salutation ?? null,
      firstName: subject?.firstName ?? story.firstName!,
      lastName: subject?.lastName ?? story.lastName!,
      effectiveDate: dateFromIso(ctx.d(story.effective)),
      departmentId: story.department ? departments.get(story.department)! : (subject?.departmentId ?? null),
      siteId: story.site ? sites.get(story.site)! : (subject?.siteId ?? null),
      managerId,
      managerDeputyId: story.managerDeputy ? user(story.managerDeputy).id : null,
      requesterId: requester.id,
      assigneeId: assigneeHandle ? user(assigneeHandle).id : null,
      reason: story.reason ?? null,
      furtherInformation: story.furtherInformation ?? null,
      equipmentNotes: story.equipmentNotes ?? null,
      birthDate: pd ? dateFromIso(pd.birthDate) : null,
      placeOfBirth: pd?.placeOfBirth ?? null,
      nationality: pd?.nationality ?? null,
      privateStreet: pd?.privateAddress?.street ?? null,
      privateHouseNumber: pd?.privateAddress?.houseNumber ?? null,
      privatePostalCode: pd?.privateAddress?.postalCode ?? null,
      privateCity: pd?.privateAddress?.city ?? null,
      privateCountryCode: pd?.privateAddress?.countryCode ?? null,
      privatePhone: pd?.privatePhone ?? null,
      privateEmail: pd?.privateEmail ?? null,
      internalNote: story.internalNote ?? null,
      statusReason: lastReason,
      closedAt: closing && ['completed', 'rejected', 'cancelled'].includes(status) ? at(closing.at) : null,
      version: 1 + story.history.length,
      createdAt,
      updatedAt: lastActivity,
    };
    await prisma.peopleRequest.create({ data });

    const label = `${reference} ${story.title}`;
    const audit = (
      row: Omit<Prisma.AuditLogUncheckedCreateInput, 'id' | 'module' | 'entityType' | 'entityId' | 'correlationId'>,
    ) =>
      prisma.auditLog.create({
        data: {
          id: ctx.uuid(row.occurredAt as Date),
          module: 'people',
          entityType: 'people_request',
          entityId: id,
          correlationId: 'seed',
          metadata: { entityLabel: label },
          ...row,
        },
      });
    const notify = async (
      userId: string | null,
      title: string,
      body: string,
      when: Date,
      priority = story.priority,
    ) => {
      if (!userId) return;
      notifications++;
      await prisma.notification.create({
        data: {
          id: ctx.uuid(when),
          userId,
          templateId: title.startsWith('New ') ? 'people.request_created' : 'people.status_changed',
          module: 'people',
          title,
          body,
          link: `/people-requests/${id}`,
          priority: priority === 'critical' || priority === 'high' ? 'high' : 'normal',
          entityType: 'people_request',
          entityId: id,
          // Older updates are read; the last three days are still unread.
          readAt: when < ctx.at(-3, 0, 0) ? new Date(when.getTime() + 3_600_000) : null,
          createdAt: when,
        },
      });
    };

    // create -> audit + in-app (requester, manager) as `people.request_created` would.
    await audit({
      occurredAt: createdAt,
      actorId: requester.id,
      actingAs: 'requester',
      action: 'create',
      toState: 'open',
    });
    const subjectName = `${data.firstName} ${data.lastName}`;
    const createdTitle = `New ${TYPE_LABELS[story.type].toLowerCase()} request: ${story.title}`;
    const createdBody = `${requester.displayName} requested ${TYPE_LABELS[story.type].toLowerCase()} for ${subjectName} (${reference}). Effective: ${shortDate(ctx.d(story.effective))}.`;
    await notify(requester.id, createdTitle, createdBody, createdAt);
    if (managerId && managerId !== requester.id) await notify(managerId, createdTitle, createdBody, createdAt);

    // history -> audit rows, status-note comments, in-app status notifications.
    let from: PeopleRequestStatus = 'open';
    for (const event of story.history) {
      const actor = user(event.by);
      const when = at(event.at);
      const to = TARGET[event.action];
      const actingAs = PEOPLE_OPS_HANDLES.has(event.by) ? 'back_office' : 'requester';
      await audit({
        occurredAt: when,
        actorId: actor.id,
        actingAs,
        action: event.action,
        fromState: from,
        toState: to,
        reason: event.reason ?? null,
      });
      const text = event.question ?? event.note;
      if (text) {
        await prisma.peopleRequestComment.create({
          data: {
            id: ctx.uuid(when),
            requestId: id,
            authorId: actor.id,
            body: text,
            internal: event.action === 'wait_internal',
            kind: event.question ? 'question' : 'status_note',
            createdAt: when,
          },
        });
      }
      const title = `${reference} is now ${STATUS_LABELS[to]}`;
      const body = [
        `${story.title}: ${STATUS_TEXT[to] ?? ''}`,
        event.question ? `Question: ${event.question}` : null,
        event.reason ? `Reason: ${event.reason}` : null,
        event.note && event.action !== 'wait_internal' ? `Note: ${event.note}` : null,
      ]
        .filter(Boolean)
        .join(' ');
      if (actor.id !== requester.id) await notify(requester.id, title, body, when);
      if (managerId && managerId !== actor.id && managerId !== requester.id) await notify(managerId, title, body, when);
      from = to;
    }

    for (const comment of story.comments) {
      const when = at(comment.at);
      await prisma.peopleRequestComment.create({
        data: {
          id: ctx.uuid(when),
          requestId: id,
          authorId: user(comment.by).id,
          body: comment.body,
          internal: comment.internal ?? false,
          kind: 'comment',
          createdAt: when,
        },
      });
    }
  }

  // Explicit reference numbers were inserted (SPEC_RESOLUTIONS #21): move the sequence past them.
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('people_requests', 'number'), (SELECT COALESCE(MAX(number), 1) FROM people_requests))`,
  );
  ctx.log(`people: ${JOB_ROLES.length} job roles, ${PEOPLE_STORY.length} requests, ${notifications} notifications`);
}

export const seeder: Seeder = { name: 'people requests and job roles', run: seedPeople };
