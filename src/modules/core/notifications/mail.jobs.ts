import { Injectable, Logger } from '@nestjs/common';
import type { JobWithMetadata } from 'pg-boss';
import { PrismaService } from '@/database/prisma.service';
import { MailTransport } from '@/infra/mail/mail-transport';
import { JobHandler } from '@/infra/queue/job-handler.decorator';
import { StorageService } from '@/infra/storage/storage.service';
import { MAIL_SEND_JOB, type MailSendJob, NotificationService } from './notification.service';
import { NotificationTemplateRegistry } from './notification-template.registry';

/**
 * `mail.send`: renders an `email_messages` row and delivers it over SMTP. Retries 5x with
 * exponential backoff (SPEC §8 core.mail-retry); after the last attempt the row is `failed`.
 */
@Injectable()
export class MailJobs {
  private readonly logger = new Logger(MailJobs.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: NotificationTemplateRegistry,
    private readonly notifications: NotificationService,
    private readonly transport: MailTransport,
    private readonly storage: StorageService,
  ) {}

  @JobHandler(MAIL_SEND_JOB, { queue: { retryLimit: 5, retryDelay: 15, retryBackoff: true } })
  async send(data: MailSendJob, job: JobWithMetadata<MailSendJob>): Promise<void> {
    const message = await this.prisma.emailMessage.findUnique({ where: { id: data.emailMessageId } });
    if (!message || message.status === 'sent') return; // idempotent
    try {
      const template = this.registry.get(message.templateId);
      if (!template) throw new Error(`Unknown notification template "${message.templateId}"`);
      const rendered = await this.notifications.render(template, message.payload, message.priority);
      const attachments = await this.loadAttachments(message.attachmentIds);
      await this.transport.deliver({
        to: message.to,
        cc: message.cc,
        subject: message.subject,
        html: rendered.html,
        text: rendered.text,
        highPriority: message.priority === 'high',
        attachments,
      });
      await this.prisma.emailMessage.update({
        where: { id: message.id },
        data: { status: 'sent', sentAt: new Date(), attempts: { increment: 1 }, lastError: null },
      });
    } catch (error) {
      const last = job.retryCount >= job.retryLimit;
      await this.prisma.emailMessage.update({
        where: { id: message.id },
        data: {
          attempts: { increment: 1 },
          lastError: error instanceof Error ? error.message.slice(0, 1000) : String(error),
          ...(last ? { status: 'failed' as const } : {}),
        },
      });
      this.logger.warn(
        `Mail ${message.id} (${message.templateId}) failed${last ? ' permanently' : ''}: ${String(error)}`,
      );
      throw error;
    }
  }

  private async loadAttachments(ids: string[]) {
    if (ids.length === 0) return [];
    const rows = await this.prisma.attachment.findMany({ where: { id: { in: ids }, deletedAt: null } });
    return Promise.all(
      rows.map(async (row) => ({
        filename: row.originalName,
        content: await this.storage.read(row.storageKey),
        contentType: row.mimeType,
      })),
    );
  }
}
