import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBody, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '@/common/auth/auth-user';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { type AppAbility, CheckAbility, CurrentAbility } from '@/common/authz';
import { ApiProblemResponses } from '@/common/http/api-problem-response.decorator';
import { UuidPipe } from '@/common/http/uuid.pipe';
import { TimelineDto } from '@/modules/people/dto/timeline.dto';
import {
  CreateNewsPostDto,
  ListNewsQuery,
  NewsPostDetailDto,
  NewsPostPageDto,
  UpdateNewsPostDto,
} from '../dto/news.dto';
import { NewsService } from '../services/news.service';

@ApiTags('news')
@ApiProblemResponses(401)
@Controller('news')
export class NewsController {
  constructor(private readonly news: NewsService) {}

  @Get()
  @ApiOperation({ summary: 'News feed (published; editors may filter by status)' })
  @ZodResponse({ type: NewsPostPageDto })
  @ApiProblemResponses(422)
  list(
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
    @Query() query: ListNewsQuery,
  ): Promise<NewsPostPageDto> {
    return this.news.list(user, ability, query);
  }

  @Post()
  @CheckAbility('create', 'NewsPost')
  @ApiOperation({ summary: 'Create a draft post (body is sanitised)' })
  @ZodResponse({ type: NewsPostDetailDto, status: 201 })
  @ApiProblemResponses(422)
  async create(
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
    @Body() dto: CreateNewsPostDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<NewsPostDetailDto> {
    const row = await this.news.create(user, dto);
    res.location(`/api/v1/news/${row.id}`);
    return this.news.toDetail(row, user, ability);
  }

  @Get(':id')
  @ZodResponse({ type: NewsPostDetailDto })
  @ApiProblemResponses(404)
  detail(
    @Param('id', UuidPipe) id: string,
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
  ): Promise<NewsPostDetailDto> {
    return this.news.detail(id, user, ability);
  }

  @Patch(':id')
  @ZodResponse({ type: NewsPostDetailDto })
  @ApiProblemResponses(403, 404, 409, 422)
  async update(
    @Param('id', UuidPipe) id: string,
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
    @Body() dto: UpdateNewsPostDto,
  ): Promise<NewsPostDetailDto> {
    const row = await this.news.update(user, id, dto);
    return this.news.toDetail(row, user, ability);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Post deleted (draft or archived only)' })
  @ApiProblemResponses(403, 404, 409)
  async remove(@Param('id', UuidPipe) id: string, @CurrentUser() user: AuthUser): Promise<void> {
    await this.news.remove(user, id);
  }

  @Post(':id/actions/:action')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Lifecycle action: publish, schedule { publishAt, expireAt? }, unschedule, archive, restore',
  })
  @ApiBody({ required: false, schema: { type: 'object' } })
  @ZodResponse({ type: NewsPostDetailDto })
  @ApiProblemResponses(403, 404, 409, 422)
  async act(
    @Param('id', UuidPipe) id: string,
    @Param('action') action: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
  ): Promise<NewsPostDetailDto> {
    await this.news.act(id, action, body, user, ability);
    return this.news.detail(id, user, ability);
  }

  @Get(':id/timeline')
  @ZodResponse({ type: [TimelineDto] })
  @ApiProblemResponses(403, 404)
  timeline(@Param('id', UuidPipe) id: string, @CurrentUser() user: AuthUser): Promise<TimelineDto[]> {
    return this.news.timeline(id, user);
  }
}
