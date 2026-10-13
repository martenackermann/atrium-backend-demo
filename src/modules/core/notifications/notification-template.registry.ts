import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { AnyNotificationTemplate } from './notification-template';

/** `src/modules/<m>/mail/*.notification.ts` (or `.js` in dist). */
const TEMPLATE_FILE = /\.notification\.(ts|js)$/;

function isTemplate(value: unknown): value is AnyNotificationTemplate {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyNotificationTemplate).id === 'string' &&
    typeof (value as AnyNotificationTemplate).subject === 'function' &&
    typeof (value as AnyNotificationTemplate).email === 'function'
  );
}

/**
 * All notification templates. Templates are discovered by folder convention
 * (`src/modules/<m>/mail/*.notification.ts`, SPEC_RESOLUTIONS #6) and can also be
 * registered explicitly via `CoreExtensionsModule.forFeature({ notifications })`.
 */
@Injectable()
export class NotificationTemplateRegistry implements OnModuleInit {
  private readonly logger = new Logger(NotificationTemplateRegistry.name);
  private readonly templates = new Map<string, AnyNotificationTemplate>();

  async onModuleInit(): Promise<void> {
    const modulesRoot = resolve(__dirname, '..', '..');
    let found = 0;
    for (const module of readdirSync(modulesRoot)) {
      const dir = join(modulesRoot, module, 'mail');
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir)
        .filter((f) => TEMPLATE_FILE.test(f) && !f.endsWith('.d.ts'))
        .sort()) {
        const exports = (await import(pathToFileURL(join(dir, file)).href)) as Record<string, unknown>;
        const templates = Object.values(exports).filter(isTemplate);
        this.register(templates);
        found += templates.length;
      }
    }
    this.logger.log(`Discovered ${found} notification templates`);
  }

  /** Registers templates; a template id registered again is ignored (first wins). */
  register(templates: readonly AnyNotificationTemplate[]): void {
    for (const template of templates) {
      if (!this.templates.has(template.id)) this.templates.set(template.id, template);
    }
  }

  get(id: string): AnyNotificationTemplate | undefined {
    return this.templates.get(id);
  }

  list(): AnyNotificationTemplate[] {
    return [...this.templates.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
}
