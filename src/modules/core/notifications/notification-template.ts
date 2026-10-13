import type { z } from 'zod';
import type { ModuleName } from '@/common/domain/vocabulary';

/**
 * A notification (SPEC §7): an email rendered in the shared MJML layout plus an in-app
 * notification for every user recipient (D17). Define one per id in
 * `src/modules/<m>/mail/<id>.notification.ts` and register it with
 * `CoreExtensionsModule.forFeature({ notifications: [...] })`.
 */
export interface NotificationTemplate<T extends object = Record<string, unknown>> {
  /** SPEC §7 id, e.g. `training.approval_requested`. */
  id: string;
  module: ModuleName;
  description?: string;
  /** Validates the context when the notification is sent. */
  schema?: z.ZodType<T>;
  /** Email subject (without the "[High priority] " prefix - added automatically). */
  subject: (ctx: T) => string;
  /** In-app title (<= 140 chars). Defaults to the subject. */
  title?: (ctx: T) => string;
  /** In-app body, plain text (<= 500 chars). */
  body: (ctx: T) => string;
  /** Email body: MJML fragment (`mj-text`, `mj-table`...). Build it with the `mjml` tag. */
  email: (ctx: T) => string;
  /** Frontend route (e.g. `/training/participations/<id>`); adds the "View in Atrium" button. */
  link?: (ctx: T) => string | null;
  /** Sample context for the dev preview route and tests. */
  preview: T;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyNotificationTemplate = NotificationTemplate<any>;

/** Identity helper that gives templates full type inference. */
export function defineNotification<T extends object>(template: NotificationTemplate<T>): NotificationTemplate<T> {
  return template;
}

export const HIGH_PRIORITY_PREFIX = '[High priority] ';

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
