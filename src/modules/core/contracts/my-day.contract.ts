import { DiscoveryService } from '@nestjs/core';
import { z } from 'zod';
import type { AuthUser } from '@/common/auth/auth-user';
import { isoDateTimeSchema, uuidSchema } from '@/common/domain/schemas';

/** API.md §7.4 UpcomingItem (training participations and travel). */
export const upcomingItemSchema = z
  .object({
    module: z.enum(['training', 'travel']),
    entityId: uuidSchema,
    kind: z.enum(['training', 'car', 'train', 'flight']),
    title: z.string(),
    subtitle: z.string().nullable(),
    startsAt: isoDateTimeSchema,
    endsAt: isoDateTimeSchema.nullable(),
    status: z.string(),
    link: z.string(),
  })
  .meta({ id: 'UpcomingItem' });

export type UpcomingItem = z.infer<typeof upcomingItemSchema>;

/**
 * Fragments of `GET /home/my-day` (owned by A4). Each contributor fills the parts it
 * owns: A1 + A2 `upcoming`, A3 `assets`, A4 `news` and `links` (typed by A4's own DTOs).
 */
export interface MyDayFragments {
  upcoming: UpcomingItem[];
  assets: { active: number; pendingAcceptance: number } | null;
  news: unknown[];
  links: unknown[];
}

/** Decorate with `@RegisterMyDayContributor()` and list it in the module's `providers`. */
export interface MyDayContributor {
  contribute(user: AuthUser): Promise<Partial<MyDayFragments>>;
}

export const RegisterMyDayContributor = DiscoveryService.createDecorator<void>();
