import { Injectable } from '@nestjs/common';
import mjml2html from 'mjml';
import { renderLayout } from './mail-layout';
import type { MailTemplate } from './mail-template';

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

/** Very small HTML-to-text fallback for templates without an explicit `text()`. */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<(br|\/p|\/div|\/tr|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*/g, '\n\n')
    .trim();
}

@Injectable()
export class MailRenderer {
  async render<T extends object>(template: MailTemplate<T>, data: T): Promise<RenderedMail> {
    const subject = template.subject(data);
    const source = renderLayout({ subject, preheader: template.preheader?.(data), body: template.body(data) });
    const result = await mjml2html(source, { validationLevel: 'strict', keepComments: false });
    return { subject, html: result.html, text: template.text?.(data) ?? htmlToText(result.html) };
  }
}
