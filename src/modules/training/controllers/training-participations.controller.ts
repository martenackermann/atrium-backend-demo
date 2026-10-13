import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '@/common/auth/auth-user';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import type { AppAbility } from '@/common/authz/ability.types';
import { CurrentAbility } from '@/common/authz/check-ability.decorator';
import { ApiProblemResponses } from '@/common/http/api-problem-response.decorator';
import { UuidPipe } from '@/common/http/uuid.pipe';
import {
  ExportParticipationsQueryDto,
  GoalsDto,
  ListParticipationsQueryDto,
  TrainingParticipationDetailDto,
  TrainingParticipationPageDto,
  TrainingTimelineEntryDto,
} from '../dto/training-request.dto';
import { TrainingParticipationsService } from '../services/training-participations.service';
import { TrainingQueuesService } from '../services/training-queues.service';

/** `/training/participations*` (API.md §4.1). `export.csv` is registered before `/:id` (SPEC_RESOLUTIONS #30). */
@ApiTags('training')
@Controller('training/participations')
export class TrainingParticipationsController {
  constructor(
    private readonly participations: TrainingParticipationsService,
    private readonly queues: TrainingQueuesService,
  ) {}

  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="training-participations.csv"')
  @Header('Cache-Control', 'private, no-store')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'CSV export of all participations with the list filters (training office)' })
  @ApiProblemResponses(403, 422)
  exportCsv(
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
    @Query() query: ExportParticipationsQueryDto,
  ): Promise<string> {
    return this.queues.exportCsv(user, ability, query);
  }

  @Get()
  @ApiOperation({ summary: 'Participations by scope: mine, approvals, executive, deputy, team, all' })
  @ZodResponse({ type: TrainingParticipationPageDto })
  @ApiProblemResponses(403, 422)
  list(
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
    @Query() query: ListParticipationsQueryDto,
  ): Promise<TrainingParticipationPageDto> {
    return this.participations.list(user, ability, query);
  }

  @Get(':id')
  @ZodResponse({ type: TrainingParticipationDetailDto })
  @ApiProblemResponses(404)
  detail(
    @Param('id', UuidPipe) id: string,
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
  ): Promise<TrainingParticipationDetailDto> {
    return this.participations.detail(id, user, ability);
  }

  @Post(':id/actions/:action')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Lifecycle action: approve, decline, withdraw, request_cancellation, confirm_cancellation, reject_cancellation, book, mark_booking_impossible, retry_booking, close',
  })
  @ZodResponse({ type: TrainingParticipationDetailDto, status: 200 })
  @ApiProblemResponses(403, 404, 409, 422)
  act(
    @Param('id', UuidPipe) id: string,
    @Param('action') action: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
  ): Promise<TrainingParticipationDetailDto> {
    return this.participations.act(id, action, body, user, ability);
  }

  @Put(':id/goals')
  @ApiOperation({ summary: 'Set the two learning goals (attendee, until the start)' })
  @ZodResponse({ type: TrainingParticipationDetailDto })
  @ApiProblemResponses(403, 404, 409, 422)
  putGoals(
    @Param('id', UuidPipe) id: string,
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
    @Body() body: GoalsDto,
  ): Promise<TrainingParticipationDetailDto> {
    return this.participations.putGoals(id, user, ability, body);
  }

  @Get(':id/timeline')
  @ZodResponse({ type: [TrainingTimelineEntryDto] })
  @ApiProblemResponses(404)
  timeline(
    @Param('id', UuidPipe) id: string,
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
  ): Promise<TrainingTimelineEntryDto[]> {
    return this.participations.timeline(id, user, ability);
  }
}
