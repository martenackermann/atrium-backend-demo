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
}

/** Nodemailer SMTP transport (Mailpit in development: localhost:1025). */
@Injectable()
export class MailTransport implements OnModuleDestroy {
  private readonly transporter: Transporter;

  constructor(private readonly config: AppConfig) {
    const port = config.get('SMTP_PORT');
    this.transporter = createTransport({ host: config.get('SMTP_HOST'), port, secure: port === 465 });
  }

  async deliver(mail: OutgoingMail): Promise<string> {
    const info = await this.transporter.sendMail({ from: this.config.get('MAIL_FROM'), ...mail });
    return String(info.messageId);
  }

  onModuleDestroy(): void {
    this.transporter.close();
  }
}
