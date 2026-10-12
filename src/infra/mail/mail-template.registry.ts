import { Injectable } from '@nestjs/common';
import type { AnyMailTemplate } from './mail-template';

/** All mail templates known to the app. Filled via `MailModule.forRoot()` / `MailModule.forFeature()`. */
@Injectable()
export class MailTemplateRegistry {
  private readonly templates = new Map<string, AnyMailTemplate>();

  register(templates: readonly AnyMailTemplate[]): void {
    for (const template of templates) {
      const existing = this.templates.get(template.name);
      if (existing && existing !== template) {
        throw new Error(`Mail template "${template.name}" is registered twice`);
      }
      this.templates.set(template.name, template);
    }
  }

  get(name: string): AnyMailTemplate | undefined {
    return this.templates.get(name);
  }

  list(): AnyMailTemplate[] {
    return [...this.templates.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}
