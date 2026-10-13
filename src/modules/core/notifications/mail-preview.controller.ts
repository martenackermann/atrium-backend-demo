import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '@/common/auth/public.decorator';
import { ProblemException } from '@/common/http/problem';
import { AppConfig } from '@/config/app-config';
import { NotificationService } from './notification.service';
import { NotificationTemplateRegistry } from './notification-template.registry';

/**
 * Development aid: renders every registered notification with its `preview` context.
 *   GET /api/v1/dev/mail-preview                  -> list
 *   GET /api/v1/dev/mail-preview/:id              -> email HTML
 *   GET /api/v1/dev/mail-preview/:id?format=text  -> subject + text part + in-app title/body
 *   add &priority=high to see the high-priority variant
 * Disabled (404) when NODE_ENV=production.
 */
@ApiExcludeController()
@Public()
@Controller('dev/mail-preview')
export class MailPreviewController {
  constructor(
    private readonly registry: NotificationTemplateRegistry,
    private readonly notifications: NotificationService,
    private readonly config: AppConfig,
  ) {}

  @Get()
  list(): { templates: { id: string; module: string; description: string | null; url: string }[] } {
    this.assertEnabled();
    const base = `${this.config.get('API_PUBLIC_URL')}/api/v1/dev/mail-preview`;
    return {
      templates: this.registry.list().map((t) => ({
        id: t.id,
        module: t.module,
        description: t.description ?? null,
        url: `${base}/${t.id}`,
      })),
    };
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  async preview(
    @Param('id') id: string,
    @Query('format') format?: string,
    @Query('priority') priority?: string,
  ): Promise<string> {
    this.assertEnabled();
    const template = this.registry.get(id);
    if (!template) throw ProblemException.notFound('Notification template');
    const ctx = template.preview as object;
    const rendered = await this.notifications.render(template, ctx, priority === 'high' ? 'high' : 'normal');
    if (format !== 'text') return rendered.html;
    const title = template.title?.(ctx) ?? template.subject(ctx);
    return `Subject: ${rendered.subject}\n\n${rendered.text}\n\n--- in-app ---\n${title}\n${template.body(ctx)}`;
  }

  private assertEnabled(): void {
    if (this.config.isProduction) throw ProblemException.notFound();
  }
}
