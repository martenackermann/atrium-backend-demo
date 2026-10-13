import { Global, Module } from '@nestjs/common';
import { MailRenderer } from './mail-renderer';
import { MailTransport } from './mail-transport';

/**
 * Low-level mail building blocks: MJML layout rendering and the SMTP transport.
 * Modules never send mail directly - they use the core NotificationService.
 */
@Global()
@Module({
  providers: [MailRenderer, MailTransport],
  exports: [MailRenderer, MailTransport],
})
export class MailModule {}
