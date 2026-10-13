import { DiscoveryService } from '@nestjs/core';
import { z } from 'zod';
import type { AuthUser } from '@/common/auth/auth-user';
import { actingAsSchema, isoDateTimeSchema, notificationPrioritySchema, uuidSchema } from '@/common/domain/schemas';
import { INBOX_MODULES, type InboxModule } from '@/common/domain/vocabulary';

/** API.md §3.2 / §8 - one value per producer row in the inbox catalogue. */
export const INBOX_ITEM_TYPES = [
  'training.approval_required',
  'training.booking_required',
  'training.cancellation_review',
  'training.rating_due',
  'training.goals_missing',
  'travel.approval_required',
  'travel.booking_required',
  'travel.cancellation_review',
  'assets.acceptance_required',
  'people.reply_required',
  'people.triage_required',
] as const;
export type InboxItemType = (typeof INBOX_ITEM_TYPES)[number];

export const inboxItemSchema = z
  .object({
    /** `${type}:${entityId}` - stable */
    id: z.string(),
    module: z.enum(INBOX_MODULES),
    type: z.enum(INBOX_ITEM_TYPES),
    reference: z.string().nullable(),
    title: z.string(),
    subtitle: z.string().nullable(),
    /** Calendar due dates are 00:00 APP_TIMEZONE as UTC (`startOfDayInZone`), SPEC_RESOLUTIONS #31. */
    dueAt: isoDateTimeSchema.nullable(),
    priority: notificationPrioritySchema,
    actingAs: actingAsSchema.nullable(),
    /** Frontend route (API.md §8). */
    link: z.string(),
    /**
     * API path of the entity for quick actions, e.g. `/training/participations/{id}`; clients post to
     * `${actionsPath}/actions/{action}` (SPEC_RESOLUTIONS #4). Null when there are no quick actions.
     */
    actionsPath: z.string().nullable(),
    entityId: uuidSchema,
    createdAt: isoDateTimeSchema,
    /** Subset of the entity's availableActions safe to run from the drawer ('approve', 'decline'). */
    quickActions: z.array(z.string()),
  })
  .meta({ id: 'InboxItem' });

export type InboxItem = z.infer<typeof inboxItemSchema>;

/**
 * Produces the current user's to-do items for one module. Implement in
 * `src/modules/<m>/services/<m>-inbox.provider.ts`, decorate with `@RegisterInboxProvider()`
 * and list it in the module's `providers`. Only return items the user may act on, already
 * permission-filtered. Keep it fast (one or two queries).
 */
export interface InboxProvider {
  readonly module: InboxModule;
  items(user: AuthUser): Promise<InboxItem[]>;
}

export const RegisterInboxProvider = DiscoveryService.createDecorator<void>();

/** Builds the stable inbox item id. */
export const inboxItemId = (type: InboxItemType, entityId: string): string => `${type}:${entityId}`;
