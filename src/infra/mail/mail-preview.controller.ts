import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '@/common/auth/public.decorator';
import { ProblemException } from '@/common/http/problem';
import { AppConfig } from '@/config/app-config';
import { MailRenderer } from './mail-renderer';
import { MailTemplateRegistry } from './mail-template.registry';

/**
 * Development aid: renders every registered template with its `preview` data.
 * GET /api/v1/dev/mail-preview            -> list
 * GET /api/v1/dev/mail-preview/:name      -> HTML (add ?format=text for the text part)
 * Disabled (404) when NODE_ENV=production.
 */
@ApiExcludeController()
@Public()
@Controller('dev/mail-preview')
export class MailPreviewController {
  constructor(
    private readonly registry: MailTemplateRegistry,
    private readonly renderer: MailRenderer,
    private readonly config: AppConfig,
  ) {}

  @Get()
  list(): { templates: { name: string; description?: string; url: string }[] } {
    this.assertEnabled();
    const base = `${this.config.get('APP_URL')}/api/v1/dev/mail-preview`;
    return {
      templates: this.registry
        .list()
        .map((t) => ({ name: t.name, description: t.description, url: `${base}/${t.name}` })),
    };
  }

  @Get(':name')
  @Header('Cache-Control', 'no-store')
  async preview(@Param('name') name: string, @Query('format') format?: string): Promise<string> {
    this.assertEnabled();
    const template = this.registry.get(name);
    if (!template) throw ProblemException.notFound('Mail template', name);
    const rendered = await this.renderer.render(template, template.preview);
    return format === 'text' ? `Subject: ${rendered.subject}\n\n${rendered.text}` : rendered.html;
  }

  private assertEnabled(): void {
    if (this.config.isProduction) throw ProblemException.notFound('Route');
  }
}
