import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import { isoFromDate } from '@/common/time/time';
import type { PrismaTx } from '@/database/prisma.types';
import type { Recipient } from '@/modules/core/notifications/notification.service';
import { NotificationService } from '@/modules/core/notifications/notification.service';
import { peopleCommentAddedNotification } from '../mail/comment-added.notification';
import { peopleRequestCreatedNotification } from '../mail/request-created.notification';
import { peopleStatusChangedNotification } from '../mail/status-changed.notification';
import {
  isHighPriority,
  isPeopleBackOffice,
  PRIORITY_LABELS,
  peopleReference,
  shortDate,
  STATUS_LABELS,
  TYPE_LABELS,
} from '../people.constants';
import type { PeopleRequestRow } from './people-access';

export const EFFECTIVE_LABELS = {
  onboarding: 'Start date',
  offboarding: 'Last working day',
  role_change: 'Change date',
} as const;

/** The three people notifications of SPEC §7 with their recipient rules. */
@Injectable()
export class PeopleNotifier {
  constructor(private readonly notifications: NotificationService) {}

  private priority(row: PeopleRequestRow) {
    return isHighPriority(row.priority) ? ('high' as const) : ('normal' as const);
  }

  /** People Ops side of a request: the assignee, or the people-ops mailbox when unassigned. */
  private opsRecipient(row: PeopleRequestRow): Recipient {
    return row.assigneeId ? { userId: row.assigneeId } : { mailbox: 'people_ops' };
  }

  async created(tx: PrismaTx, row: PeopleRequestRow): Promise<void> {
    const cc: Recipient[] = [{ userId: row.requesterId }];
    if (row.managerId && row.managerId !== row.requesterId) cc.push({ userId: row.managerId });
    await this.notifications.send(
      peopleRequestCreatedNotification,
      {
        to: [{ mailbox: 'people_ops' }],
        cc,
        context: {
          requestId: row.id,
          reference: peopleReference(row.number),
          typeLabel: TYPE_LABELS[row.type],
          title: row.title,
          effectiveDate: shortDate(isoFromDate(row.effectiveDate)),
          effectiveLabel: EFFECTIVE_LABELS[row.type],
          priorityLabel: PRIORITY_LABELS[row.priority],
          requesterName: row.requester.displayName,
          subjectName: `${row.firstName} ${row.lastName}`,
        },
        priority: this.priority(row),
        entity: { type: 'people_request', id: row.id },
      },
      { tx },
    );
  }

  /**
   * Every transition -> requester, cc manager. When the requester acts (cancel, reopen),
   * People Ops is told instead. The actor never notifies themselves.
   */
  async statusChanged(
    tx: PrismaTx,
    row: PeopleRequestRow,
    actor: AuthUser,
    extra: { question?: string | null; reason?: string | null; note?: string | null },
  ): Promise<void> {
    const to: Recipient[] = [];
    if (row.requesterId !== actor.id) to.push({ userId: row.requesterId });
    else to.push(this.opsRecipient(row));
    const cc: Recipient[] = [];
    if (row.managerId && row.managerId !== actor.id && row.managerId !== row.requesterId) {
      cc.push({ userId: row.managerId });
    }
    await this.notifications.send(
      peopleStatusChangedNotification,
      {
        to: to.filter((r) => !('userId' in r) || r.userId !== actor.id),
        cc,
        context: {
          requestId: row.id,
          reference: peopleReference(row.number),
          title: row.title,
          status: row.status,
          statusLabel: STATUS_LABELS[row.status],
          actorName: actor.displayName,
          question: extra.question ?? null,
          reason: extra.reason ?? null,
          note: extra.note ?? null,
        },
        priority: this.priority(row),
        entity: { type: 'people_request', id: row.id },
      },
      { tx },
    );
  }

  /** Public comment notification (internal comments never notify). */
  async commentAdded(tx: PrismaTx, row: PeopleRequestRow, author: AuthUser, body: string): Promise<void> {
    const to: Recipient[] = [];
    const isRequester = row.requesterId === author.id;
    if (isRequester) {
      to.push(this.opsRecipient(row));
    } else if (isPeopleBackOffice(author)) {
      to.push({ userId: row.requesterId });
    } else {
      // The manager (or another viewer allowed to comment): requester + People Ops.
      to.push({ userId: row.requesterId }, this.opsRecipient(row));
    }
    const recipients = to.filter((r) => !('userId' in r) || r.userId !== author.id);
    if (recipients.length === 0) return;
    await this.notifications.send(
      peopleCommentAddedNotification,
      {
        to: recipients,
        context: {
          requestId: row.id,
          reference: peopleReference(row.number),
          title: row.title,
          authorName: author.displayName,
          excerpt: body,
        },
        entity: { type: 'people_request', id: row.id },
      },
      { tx },
    );
  }
}
