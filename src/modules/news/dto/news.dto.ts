import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { isoDateTimeSchema, signedImageSchema, userRefSchema, uuidSchema } from '@/common/domain/schemas';
import { paginatedSchema, paginationQuerySchema } from '@/common/http/pagination';
import { sortParam } from '@/common/http/sort';
import { NEWS_ACTIONS, NEWS_STATUSES, NEWS_TYPES } from '../news.enums';

export const newsTypeSchema = z.enum(NEWS_TYPES);
export const newsStatusSchema = z.enum(NEWS_STATUSES);

export const newsPostSummarySchema = z.object({
  id: uuidSchema,
  title: z.string(),
  type: newsTypeSchema,
  status: newsStatusSchema,
  summary: z.string(),
  coverImage: z.object(signedImageSchema.shape).nullable(),
  pinned: z.boolean(),
  publishAt: isoDateTimeSchema.nullable(),
  expireAt: isoDateTimeSchema.nullable(),
  publishedAt: isoDateTimeSchema.nullable(),
  author: userRefSchema,
  updatedAt: isoDateTimeSchema,
  availableActions: z.array(z.enum(NEWS_ACTIONS)),
});
export type NewsPostSummaryView = z.infer<typeof newsPostSummarySchema>;

export const newsPostDetailSchema = newsPostSummarySchema.extend({
  /** Sanitised server-side (SPEC §4.6); render with DOMPurify as defence in depth. */
  bodyHtml: z.string(),
  createdAt: isoDateTimeSchema,
  version: z.number().int(),
});
export type NewsPostDetailView = z.infer<typeof newsPostDetailSchema>;

export class NewsPostSummaryDto extends createZodDto(newsPostSummarySchema) {}
export class NewsPostDetailDto extends createZodDto(newsPostDetailSchema) {}
export class NewsPostPageDto extends createZodDto(paginatedSchema(newsPostSummarySchema)) {}

const BODY_MAX = 50_000;

export const createNewsPostSchema = z.strictObject({
  title: z.string().trim().min(3).max(140),
  type: newsTypeSchema,
  /** Plain text, <= 280. May be empty while drafting; publishing requires it. */
  summary: z.string().trim().max(280),
  bodyHtml: z.string().max(BODY_MAX),
  coverImageId: uuidSchema.nullish(),
  pinned: z.boolean().optional(),
  expireAt: isoDateTimeSchema.nullish(),
});
export type CreateNewsPostInput = z.infer<typeof createNewsPostSchema>;
export class CreateNewsPostDto extends createZodDto(createNewsPostSchema) {}

export const updateNewsPostSchema = z.strictObject({
  title: createNewsPostSchema.shape.title.optional(),
  type: newsTypeSchema.optional(),
  summary: createNewsPostSchema.shape.summary.optional(),
  bodyHtml: createNewsPostSchema.shape.bodyHtml.optional(),
  coverImageId: uuidSchema.nullish(),
  pinned: z.boolean().optional(),
  expireAt: isoDateTimeSchema.nullish(),
  version: z.number().int().min(1).optional(),
});
export type UpdateNewsPostInput = z.infer<typeof updateNewsPostSchema>;
export class UpdateNewsPostDto extends createZodDto(updateNewsPostSchema) {}

/** Action bodies (API.md §7.2). */
export const scheduleBody = z.strictObject({
  publishAt: isoDateTimeSchema,
  expireAt: isoDateTimeSchema.nullish(),
});
export const emptyBody = z.strictObject({});

const csvEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    )
    .pipe(z.array(z.enum(values)));

export const listNewsQuerySchema = paginationQuerySchema.extend({
  /** Editors only; everyone else always gets published posts. */
  status: csvEnum(NEWS_STATUSES),
  type: csvEnum(NEWS_TYPES),
  q: z.string().trim().max(100).optional(),
  /** Default: pinned first, then -publishedAt (editors: -updatedAt). */
  sort: sortParam({ allowed: ['publishedAt', 'updatedAt', 'publishAt'] }),
});
export type ListNewsQueryInput = z.infer<typeof listNewsQuerySchema>;
export class ListNewsQuery extends createZodDto(listNewsQuerySchema) {}
