import { type DynamicModule, Module } from '@nestjs/common';
import { MailJobs } from './mail.jobs';
import { MailService } from './mail.service';
import { MailPreviewController } from './mail-preview.controller';
import { MailRenderer } from './mail-renderer';
import type { AnyMailTemplate } from './mail-template';
import { MailTemplateRegistry } from './mail-template.registry';
import { MailTransport } from './mail-transport';
import { systemTestMail } from './templates/system-test.mail';

let featureCounter = 0;

/**
 * Transactional mail: MJML templates rendered in a shared layout, delivered by a pg-boss job
 * through SMTP. `forRoot()` once in AppModule; modules register templates with `forFeature()`.
 */
@Module({})
export class MailModule {
  static forRoot(): DynamicModule {
    return {
      module: MailModule,
      global: true,
      controllers: [MailPreviewController],
      providers: [
        MailTemplateRegistry,
        MailRenderer,
        MailTransport,
        MailService,
        MailJobs,
        MailModule.registration([systemTestMail]),
      ],
      exports: [MailService, MailTemplateRegistry, MailRenderer],
    };
  }

  /** `imports: [MailModule.forFeature([requestApprovedMail, ...])]` in a feature module. */
  static forFeature(templates: readonly AnyMailTemplate[]): DynamicModule {
    return { module: MailFeatureModule, providers: [MailModule.registration(templates)] };
  }

  private static registration(templates: readonly AnyMailTemplate[]) {
    return {
      provide: `MAIL_TEMPLATES_${featureCounter++}`,
      inject: [MailTemplateRegistry],
      useFactory: (registry: MailTemplateRegistry) => {
        registry.register(templates);
        return templates;
      },
    };
  }
}

@Module({})
export class MailFeatureModule {}
