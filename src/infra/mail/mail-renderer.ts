import { Injectable } from '@nestjs/common';
import mjml2html from 'mjml';
import { type LayoutInput, renderLayout } from './mail-layout';

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

/** Very small HTML-to-text fallback for the plain-text part. */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, inner: string) => {
      const label = inner
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      return label && label !== href ? `${label} (${href})` : href;
    })
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

/** Renders an MJML body inside the Atrium layout to HTML + text. */
@Injectable()
export class MailRenderer {
  async render(input: LayoutInput & { text?: string }): Promise<RenderedMail> {
    const result = await mjml2html(renderLayout(input), { validationLevel: 'strict', keepComments: false });
    return { subject: input.subject, html: result.html, text: input.text ?? htmlToText(result.html) };
  }
}
