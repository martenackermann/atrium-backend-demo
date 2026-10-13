import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import type { AuthUser } from '@/common/auth/auth-user';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { INBOX_MODULES } from '@/common/domain/vocabulary';
import { ApiProblemResponses } from '@/common/http/api-problem-response.decorator';
import { INBOX_ITEM_TYPES, inboxItemSchema } from '../contracts/inbox.contract';
import { searchHitSchema } from '../contracts/search.contract';
import { InboxService } from './inbox.service';

const csv = <T extends readonly [string, ...string[]]>(values: T) =>
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

class InboxQuery extends createZodDto(z.object({ module: csv(INBOX_MODULES), type: csv(INBOX_ITEM_TYPES) })) {}

const countsSchema = z.object({
  training: z.number().int(),
  travel: z.number().int(),
  assets: z.number().int(),
  people: z.number().int(),
});
class InboxResponseDto extends createZodDto(
  z.object({
    data: z.array(inboxItemSchema),
    meta: z.object({ total: z.number().int(), high: z.number().int(), byModule: countsSchema }),
  }),
) {}
class InboxCountsDto extends createZodDto(countsSchema.extend({ total: z.number().int(), high: z.number().int() })) {}

class SearchQuery extends createZodDto(z.object({ q: z.string().trim().min(2).max(100) })) {}
class SearchResponseDto extends createZodDto(z.object({ data: z.array(searchHitSchema) })) {}

@ApiTags('me')
@Controller('me/inbox')
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  @ApiOperation({ summary: 'To-do items from every module (max 200, not paged)' })
  @ZodResponse({ type: InboxResponseDto })
  @ApiProblemResponses(422)
  list(@CurrentUser() user: AuthUser, @Query() query: InboxQuery): Promise<InboxResponseDto> {
    return this.inbox.inbox(user, { modules: query.module, types: query.type });
  }

  @Get('counts')
  @ApiOperation({ summary: 'Badge counts for the inbox' })
  @ZodResponse({ type: InboxCountsDto })
  async counts(@CurrentUser() user: AuthUser): Promise<InboxCountsDto> {
    const { meta } = await this.inbox.inbox(user);
    return { total: meta.total, high: meta.high, ...meta.byModule };
  }
}

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  @ApiOperation({ summary: 'Command-palette search across modules (<= 5 hits per module)' })
  @ZodResponse({ type: SearchResponseDto })
  @ApiProblemResponses(422)
  async search(@CurrentUser() user: AuthUser, @Query() query: SearchQuery): Promise<SearchResponseDto> {
    return { data: await this.inbox.search(user, query.q) };
  }
}
