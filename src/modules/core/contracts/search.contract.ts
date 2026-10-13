import { DiscoveryService } from '@nestjs/core';
import { z } from 'zod';
import type { AuthUser } from '@/common/auth/auth-user';
import { uuidSchema } from '@/common/domain/schemas';

export const SEARCH_HIT_TYPES = [
  'training_request',
  'training_participation',
  'travel_request',
  'asset',
  'people_request',
  'news_post',
] as const;

export const searchHitSchema = z
  .object({
    module: z.enum(['training', 'travel', 'assets', 'people', 'news']),
    type: z.enum(SEARCH_HIT_TYPES),
    id: uuidSchema,
    reference: z.string().nullable(),
    title: z.string(),
    subtitle: z.string().nullable(),
    /** Frontend route. */
    link: z.string(),
  })
  .meta({ id: 'SearchHit' });

export type SearchHit = z.infer<typeof searchHitSchema>;

/** Max hits a provider may return (API.md §3.5). */
export const SEARCH_HITS_PER_PROVIDER = 5;

/**
 * Command-palette search for one module. Return at most 5 hits the user may see.
 * Match references exactly (case-insensitive) and text with ILIKE; never `LIKE '%id%'`.
 * Decorate with `@RegisterSearchProvider()` and list it in the module's `providers`.
 */
export interface SearchProvider {
  readonly module: SearchHit['module'];
  search(user: AuthUser, q: string): Promise<SearchHit[]>;
}

export const RegisterSearchProvider = DiscoveryService.createDecorator<void>();
