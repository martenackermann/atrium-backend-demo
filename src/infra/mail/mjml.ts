import type { z } from 'zod';

/**
 * A transactional email. `body` returns an MJML fragment placed inside the Atrium layout
 * (header wordmark + footer), i.e. `<mj-text>`, `<mj-button>`, `<mj-table>`... elements.
 * Build fragments with the `mjml` tagged template so interpolated values are escaped.
 */
export interface MailTemplate<T extends object = Record<string, unknown>> {
  /** Unique name `<module>.<purpose>`, e.g. `training.request-approved`. */
  name: string;
  description?: string;
  /** Optional schema; data is validated when the mail is queued. */
  schema?: z.ZodType<T>;
  subject: (data: T) => string;
  /** Inbox preview line. */
  preheader?: (data: T) => string;
  body: (data: T) => string;
  /** Plain-text alternative; derived from the HTML when omitted. */
  text?: (data: T) => string;
  /** Sample data used by the dev preview route and tests. */
  preview: T;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyMailTemplate = MailTemplate<any>;

/** Identity helper that gives templates full type inference. */
export function defineMailTemplate<T extends object>(template: MailTemplate<T>): MailTemplate<T> {
  return template;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function toText(value: unknown): string {
  switch (typeof value) {
    case 'string':
      return value;
    case 'number':
    case 'boolean':
    case 'bigint':
      return value.toString();
    case 'object':
      return value === null ? '' : JSON.stringify(value);
    default:
      return '';
  }
}

export function escapeHtml(value: unknown): string {
  return toText(value).replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

class RawMarkup {
  constructor(readonly value: string) {}
}

/** Marks trusted markup so `mjml` does not escape it. */
export function raw(markup: string): RawMarkup {
  return new RawMarkup(markup);
}

/**
 * Tagged template for MJML/HTML fragments: interpolations are HTML-escaped unless wrapped
 * in `raw()`. Arrays are joined.
 *
 * @example mjml`<mj-text>Hello ${user.name}</mj-text>`
 */
export function mjml(strings: TemplateStringsArray, ...values: unknown[]): string {
  const render = (value: unknown): string =>
    value instanceof RawMarkup ? value.value : Array.isArray(value) ? value.map(render).join('') : escapeHtml(value);
  return strings.reduce((out, chunk, index) => out + chunk + (index < values.length ? render(values[index]) : ''), '');
}
