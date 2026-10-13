import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { AppConfig } from '@/config/app-config';

export interface OutgoingMail {
  to: string[];
  cc?: string[];
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  highPriority?: boolean;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}

/** Nodemailer SMTP transport (Mailpit in development: 127.0.0.1:1025). */
@Injectable()
export class MailTransport implements OnModuleDestroy {
  private readonly transporter: Transporter;

  constructor(private readonly config: AppConfig) {
    const port = config.get('SMTP_PORT');
    this.transporter = createTransport({ host: config.get('SMTP_HOST'), port, secure: port === 465 });
  }

  async deliver(mail: OutgoingMail): Promise<string> {
    const { highPriority, ...rest } = mail;
    const info = await this.transporter.sendMail({
      from: this.config.get('MAIL_FROM'),
      ...rest,
      ...(highPriority ? { priority: 'high' as const, headers: { 'X-Priority': '1' } } : {}),
    });
    return String(info.messageId);
  }

  /** SMTP reachability for the health endpoint. */
  async verify(): Promise<boolean> {
    try {
      return await this.transporter.verify();
    } catch {
      return false;
    }
  }

  onModuleDestroy(): void {
    this.transporter.close();
  }
}
