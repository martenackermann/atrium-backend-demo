import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { isoDateSchema } from '@/common/domain/schemas';
import { inboxItemSchema } from '@/modules/core/contracts/inbox.contract';
import { upcomingItemSchema } from '@/modules/core/contracts/my-day.contract';
import { usefulLinkSchema } from '@/modules/news/dto/links.dto';
import { newsPostSummarySchema } from '@/modules/news/dto/news.dto';

/** API.md §7.4 `MyDay`. */
export const myDaySchema = z.object({
  date: isoDateSchema,
  inbox: z.object({ total: z.number().int(), high: z.number().int(), top: z.array(inboxItemSchema) }),
  upcoming: z.array(upcomingItemSchema),
  assets: z.object({ active: z.number().int(), pendingAcceptance: z.number().int() }).nullable(),
  news: z.array(newsPostSummarySchema),
  links: z.array(usefulLinkSchema),
});
export type MyDayView = z.infer<typeof myDaySchema>;
export class MyDayDto extends createZodDto(myDaySchema) {}
