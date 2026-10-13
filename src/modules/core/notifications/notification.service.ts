import { Injectable } from '@nestjs/common';
import type { NotificationPriority } from '@/common/domain/vocabulary';
import { isZodErrorLike } from '@/common/http/zod-errors';
import { AppConfig } from '@/config/app-config';
import { PrismaService } from '@/database/prisma.service';
import type { PrismaTx } from '@/database/prisma.types';
import { MailRenderer, type RenderedMail } from '@/infra/mail/mail-renderer';
import { QueueService } from '@/infra/queue/queue.service';
import { HIGH_PRIORITY_PREFIX, type NotificationTemplate, truncate } from './notification-template';
import { NotificationTemplateRegistry } from './notification-template.registry';

export const MAIL_SEND_JOB = 'mail.send';

export interface MailSendJob {
  emailMessageId: string;
}

/** Functional mailboxes (SPEC §9 MAILBOX_*): they receive email only, no in-app notification. */
export type Mailbox = 'travel_desk' | 'training_office' | 'people_ops' | 'it_support';

export type Recipient = { userId: string } | { mailbox: Mailbox } | { email: string };

export interface SendNotificationInput<T extends object> {
  to: Recipient[];
  cc?: Recipient[];
  context: T;
  priority?: NotificationPriority;
  /** The record the notification is about (stored on email + in-app rows). */
  entity?: { type: string; id: string };
  /** Linked attachment ids to attach to the email (e.g. booking confirmation PDFs). */
  attachmentIds?: string[];
}

export interface SendNotificationResult {
  emailMessageId: string | null;
  notificationIds: string[];
}

const MAILBOX_ENV = {
  travel_desk: 'MAILBOX_TRAVEL_DESK',
  training_office: 'MAILBOX_TRAINING_OFFICE',
  people_ops: 'MAILBOX_PEOPLE_OPS',
  it_support: 'MAILBOX_IT_SUPPORT',
} as const;

/**
 * Sends a notification (SPEC §7, D17): writes the `email_messages` outbox row and one
 * `notifications` row per user recipient, and enqueues the `mail.send` job - all in the
 * given transaction, so nothing is sent if the business change rolls back.
 */
@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: NotificationTemplateRegistry,
    private readonly queue: QueueService,
    private readonly renderer: MailRenderer,
    private readonly config: AppConfig,
  ) {}

  /**
   * @example
   * await this.notifications.send(approvalRequested, {
   *   to: [{ userId: approverId }], cc: deputies.map((d) => ({ userId: d.id })),
   *   context: { ... }, priority: high ? 'high' : 'normal',
   *   entity: { type: 'training_attendee', id: attendee.id },
   * }, { tx });
   */
  async send<T extends object>(
    template: NotificationTemplate<T>,
    input: SendNotificationInput<T>,
    options: { tx?: PrismaTx } = {},
  ): Promise<SendNotificationResult> {
    if (!this.registry.get(template.id)) {
      throw new Error(
        `Notification "${template.id}" is not registered (put it in src/modules/<m>/mail/*.notification.ts)`,
      );
    }
    const context = this.parseContext(template, input.context);
    if (options.tx) return this.write(options.tx, template, input, context);
    return this.prisma.$transaction((tx) => this.write(tx, template, input, context));
  }

  /** Renders the email for a template + context (used by the mail job and the preview route). */
  render<T extends object>(
    template: NotificationTemplate<T>,
    context: T,
    priority: NotificationPriority,
  ): Promise<RenderedMail> {
    const link = template.link?.(context) ?? null;
    const high = priority === 'high';
    return this.renderer.render({
      subject: `${high ? HIGH_PRIORITY_PREFIX : ''}${template.subject(context)}`,
      preheader: truncate(template.body(context), 140),
      body: template.email(context),
      action: link ? { label: 'View in Atrium', url: this.absoluteLink(link) } : undefined,
      highPriority: high,
    });
  }

  absoluteLink(link: string): string {
    return `${this.config.get('APP_BASE_URL').replace(/\/$/, '')}${link.startsWith('/') ? link : `/${link}`}`;
  }

  private async write<T extends object>(
    tx: PrismaTx,
    template: NotificationTemplate<T>,
    input: SendNotificationInput<T>,
    context: T,
  ): Promise<SendNotificationResult> {
    const priority = input.priority ?? 'normal';
    const to = await this.resolve(tx, input.to);
    const cc = await this.resolve(tx, input.cc ?? []);
    const toEmails = unique(to.emails);
    const ccEmails = unique(cc.emails).filter((email) => !toEmails.includes(email));

    let emailMessageId: string | null = null;
    if (toEmails.length > 0) {
      const subject = `${priority === 'high' ? HIGH_PRIORITY_PREFIX : ''}${template.subject(context)}`;
      const message = await tx.emailMessage.create({
        data: {
          templateId: template.id,
          to: toEmails,
          cc: ccEmails,
          subject,
          priority,
          status: 'queued',
          attachmentIds: input.attachmentIds ?? [],
          payload: context,
          entityType: input.entity?.type ?? null,
          entityId: input.entity?.id ?? null,
        },
      });
      emailMessageId = message.id;
      await this.queue.send<MailSendJob>(MAIL_SEND_JOB, { emailMessageId: message.id }, { tx });
    }

    const userIds = unique([...to.userIds, ...cc.userIds]);
    const link = template.link?.(context) ?? null;
    const title = truncate(template.title?.(context) ?? template.subject(context), 140);
    const body = truncate(template.body(context), 500);
    const notificationIds: string[] = [];
    for (const userId of userIds) {
      const row = await tx.notification.create({
        data: {
          userId,
          templateId: template.id,
          module: template.module,
          title,
          body,
          link,
          priority,
          entityType: input.entity?.type ?? null,
          entityId: input.entity?.id ?? null,
        },
      });
      notificationIds.push(row.id);
    }
    return { emailMessageId, notificationIds };
  }

  private async resolve(tx: PrismaTx, recipients: Recipient[]): Promise<{ emails: string[]; userIds: string[] }> {
    const userIds = recipients.flatMap((r) => ('userId' in r ? [r.userId] : []));
    const users = userIds.length
      ? await tx.user.findMany({ where: { id: { in: userIds }, active: true }, select: { id: true, email: true } })
      : [];
    const emails = recipients.flatMap((r) => {
      if ('mailbox' in r) return [this.config.get(MAILBOX_ENV[r.mailbox])];
      if ('email' in r) return [r.email.toLowerCase()];
      return [];
    });
    return { emails: [...users.map((u) => u.email), ...emails], userIds: users.map((u) => u.id) };
  }

  private parseContext<T extends object>(template: NotificationTemplate<T>, context: T): T {
    if (!template.schema) return context;
    const result = template.schema.safeParse(context);
    if (!result.success) {
      const issues = isZodErrorLike(result.error)
        ? result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
        : [];
      throw new Error(`Invalid context for notification "${template.id}": ${issues.join('; ')}`);
    }
    return result.data;
  }
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
