import { Injectable } from '@nestjs/common';
import type { PrismaTx } from '@/database/prisma.types';
import { QueueService } from '@/infra/queue/queue.service';
import { MailRenderer } from './mail-renderer';
import type { MailTemplate } from './mail-template';
import { MailTemplateRegistry } from './mail-template.registry';
import { MailTransport } from './mail-transport';

export const MAIL_SEND_JOB = 'mail.send';

export interface MailJob {
  template: string;
  to: string[];
  cc?: string[];
  replyTo?: string;
  data: Record<string, unknown>;
}

export interface SendMailInput<T extends object> {
  to: string | string[];
  cc?: string | string[];
  replyTo?: string;
  data: T;
}

const toList = (value: string | string[] | undefined): string[] | undefined =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value];

/** Queues templated emails; the `mail.send` job renders and delivers them. */
@Injectable()
export class MailService {
  constructor(
    private readonly queue: QueueService,
    private readonly registry: MailTemplateRegistry,
    private readonly renderer: MailRenderer,
    private readonly transport: MailTransport,
  ) {}

  /**
   * Validates and enqueues a mail. Pass `tx` to enqueue atomically with your own writes.
   *
   * @example await this.mail.send(requestApprovedMail, { to: user.email, data: { ... } }, { tx })
   */
  async send<T extends object>(
    template: MailTemplate<T>,
    input: SendMailInput<T>,
    options: { tx?: PrismaTx } = {},
  ): Promise<string | null> {
    if (this.registry.get(template.name) !== template) {
      throw new Error(`Mail template "${template.name}" is not registered (use MailModule.forFeature)`);
    }
    const data = template.schema ? template.schema.parse(input.data) : input.data;
    const job: MailJob = {
      template: template.name,
      to: toList(input.to) ?? [],
      cc: toList(input.cc),
      replyTo: input.replyTo,
      data: data as Record<string, unknown>,
    };
    return this.queue.send(MAIL_SEND_JOB, job, { tx: options.tx, retryLimit: 3, retryDelay: 30 });
  }

  /** Renders and delivers immediately (used by the job handler; avoid in request handlers). */
  async deliver(job: MailJob): Promise<string> {
    const template = this.registry.get(job.template);
    if (!template) throw new Error(`Unknown mail template "${job.template}"`);
    const rendered = await this.renderer.render(template, job.data);
    return this.transport.deliver({ to: job.to, cc: job.cc, replyTo: job.replyTo, ...rendered });
  }
}
