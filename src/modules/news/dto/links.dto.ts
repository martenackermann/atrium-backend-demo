import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { optionalTextSchema, uuidSchema } from '@/common/domain/schemas';
import { LINK_ICONS } from '../news.enums';

const booleanQuery = z.enum(['true', 'false']).transform((v) => v === 'true');

export const usefulLinkSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  url: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  category: z.string().nullable(),
  sortOrder: z.number().int(),
  active: z.boolean(),
});
export type UsefulLinkView = z.infer<typeof usefulLinkSchema>;
export class UsefulLinkDto extends createZodDto(usefulLinkSchema) {}

const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .pipe(z.url({ protocol: /^https$/, hostname: z.regexes.domain }))
  .refine((v) => v.startsWith('https://'), 'Use an https:// address.');

export const usefulLinkInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(80),
  url: httpsUrl,
  description: optionalTextSchema(200),
  icon: z.enum(LINK_ICONS).nullish(),
  category: optionalTextSchema(60),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});
export type UsefulLinkInput = z.infer<typeof usefulLinkInputSchema>;
export class UsefulLinkInputDto extends createZodDto(usefulLinkInputSchema) {}

export const updateUsefulLinkSchema = z.strictObject({
  title: usefulLinkInputSchema.shape.title.optional(),
  url: httpsUrl.optional(),
  description: optionalTextSchema(200).optional(),
  icon: z.enum(LINK_ICONS).nullish(),
  category: optionalTextSchema(60).optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});
export type UpdateUsefulLinkInput = z.infer<typeof updateUsefulLinkSchema>;
export class UpdateUsefulLinkDto extends createZodDto(updateUsefulLinkSchema) {}

export const reorderLinksSchema = z.strictObject({ ids: z.array(uuidSchema).min(1).max(200) });
export class ReorderLinksDto extends createZodDto(reorderLinksSchema) {}

export const listLinksQuerySchema = z.object({ includeInactive: booleanQuery.default(false) });
export class ListLinksQuery extends createZodDto(listLinksQuerySchema) {}
