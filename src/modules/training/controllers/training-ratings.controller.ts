import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '@/common/auth/auth-user';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import type { AppAbility } from '@/common/authz/ability.types';
import { CurrentAbility } from '@/common/authz/check-ability.decorator';
import { ApiProblemResponses } from '@/common/http/api-problem-response.decorator';
import { UuidPipe } from '@/common/http/uuid.pipe';
import {
  ListRatingsQueryDto,
  RatingStatsDto,
  RatingStatsQueryDto,
  RatingSubmissionDto,
  TrainingCountsDto,
  TrainingRatingDto,
  TrainingRatingPageDto,
} from '../dto/training-request.dto';
import { TrainingQueuesService } from '../services/training-queues.service';
import { TrainingRatingsService } from '../services/training-ratings.service';

/** `/training/ratings*` (API.md §4.1). `stats` is registered before `/:id` (SPEC_RESOLUTIONS #30). */
@ApiTags('training')
@Controller('training/ratings')
export class TrainingRatingsController {
  constructor(private readonly ratings: TrainingRatingsService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Rating statistics by training end date (training office)' })
  @ZodResponse({ type: RatingStatsDto })
  @ApiProblemResponses(403, 422)
  stats(
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
    @Query() query: RatingStatsQueryDto,
  ): Promise<RatingStatsDto> {
    return this.ratings.stats(user, ability, query.from, query.to);
  }

  @Get()
  @ApiOperation({ summary: 'Feedback rounds I rate (scope=mine) or all (scope=all, training office)' })
  @ZodResponse({ type: TrainingRatingPageDto })
  @ApiProblemResponses(403, 422)
  list(
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
    @Query() query: ListRatingsQueryDto,
  ): Promise<TrainingRatingPageDto> {
    return this.ratings.list(user, ability, query);
  }

  @Get(':id')
  @ZodResponse({ type: TrainingRatingDto })
  @ApiProblemResponses(404)
  get(
    @Param('id', UuidPipe) id: string,
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
  ): Promise<TrainingRatingDto> {
    return this.ratings.get(id, user, ability);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit a due feedback round (loop must match the row)' })
  @ZodResponse({ type: TrainingRatingDto, status: 200 })
  @ApiProblemResponses(403, 404, 409, 422)
  submit(
    @Param('id', UuidPipe) id: string,
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
    @Body() body: RatingSubmissionDto,
  ): Promise<TrainingRatingDto> {
    return this.ratings.submit(id, user, ability, body);
  }
}

/** `GET /training/queues/counts` - nav badges and queue tabs. */
@ApiTags('training')
@Controller('training/queues')
export class TrainingQueuesController {
  constructor(private readonly queues: TrainingQueuesService) {}

  @Get('counts')
  @ApiOperation({ summary: 'Counts for my training, approvals and (training office) queues' })
  @ZodResponse({ type: TrainingCountsDto })
  counts(@CurrentUser() user: AuthUser, @CurrentAbility() ability: AppAbility): Promise<TrainingCountsDto> {
    return this.queues.counts(user, ability);
  }
}
