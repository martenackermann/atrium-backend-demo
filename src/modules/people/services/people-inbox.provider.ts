import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import { hasRole } from '@/common/auth/auth-user';
import { Clock } from '@/common/time/clock.service';
import { isoFromDate, startOfDayInZone } from '@/common/time/time';
import { PrismaService } from '@/database/prisma.service';
import {
  type InboxItem,
  inboxItemId,
  type InboxProvider,
  RegisterInboxProvider,
} from '@/modules/core/contracts/inbox.contract';
import { truncate } from '@/modules/core/notifications/notification-template';
import { isHighPriority, peopleReference, shortDate, TYPE_LABELS } from '../people.constants';

/**
 * API.md §8 people producers:
 * - `people.reply_required`: I'm the requester and People Ops waits on me.
 * - `people.triage_required`: people_ops; open/reopened, unassigned or assigned to me.
 * it_admin gets no back-office items (it supervises through navigation).
 */
@Injectable()
@RegisterInboxProvider()
export class PeopleInboxProvider implements InboxProvider {
  readonly module = 'people' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async items(user: AuthUser): Promise<InboxItem[]> {
    const dueAt = (date: Date) => startOfDayInZone(isoFromDate(date), this.clock.timeZone).toISOString();

    const waiting = await this.prisma.peopleRequest.findMany({
      where: { requesterId: user.id, status: 'waiting_on_requester' },
      include: {
        comments: { where: { kind: 'question', internal: false }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    const items: InboxItem[] = waiting.map((row) => ({
      id: inboxItemId('people.reply_required', row.id),
      module: 'people',
      type: 'people.reply_required',
      reference: peopleReference(row.number),
      title: `Reply needed: ${row.title}`,
      subtitle: row.comments[0] ? truncate(row.comments[0].body, 120) : null,
      dueAt: dueAt(row.effectiveDate),
      priority: isHighPriority(row.priority) ? 'high' : 'normal',
      actingAs: 'requester',
      link: `/people-requests/${row.id}`,
      actionsPath: `/people/requests/${row.id}`,
      entityId: row.id,
      createdAt: row.updatedAt.toISOString(),
      quickActions: [],
    }));

    if (hasRole(user, 'people_ops')) {
      const triage = await this.prisma.peopleRequest.findMany({
        where: {
          status: { in: ['open', 'reopened'] },
          AND: [
            { OR: [{ assigneeId: null }, { assigneeId: user.id }] },
            // Never triage a request about yourself (SPEC_RESOLUTIONS #13 spirit). NULL-safe.
            { OR: [{ subjectUserId: null }, { subjectUserId: { not: user.id } }] },
          ],
        },
        include: { requester: true },
      });
      for (const row of triage) {
        items.push({
          id: inboxItemId('people.triage_required', row.id),
          module: 'people',
          type: 'people.triage_required',
          reference: peopleReference(row.number),
          title: `${TYPE_LABELS[row.type]}: ${row.title}`,
          subtitle: `${row.requester.displayName} · effective ${shortDate(isoFromDate(row.effectiveDate))}`,
          dueAt: dueAt(row.effectiveDate),
          priority: isHighPriority(row.priority) ? 'high' : 'normal',
          actingAs: 'back_office',
          link: `/back-office/people?queue=open&selected=${row.id}`,
          actionsPath: `/people/requests/${row.id}`,
          entityId: row.id,
          createdAt: row.createdAt.toISOString(),
          quickActions: [],
        });
      }
    }
    return items;
  }
}
