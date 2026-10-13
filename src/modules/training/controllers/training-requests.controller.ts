import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '@/common/auth/auth-user';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import type { AppAbility } from '@/common/authz/ability.types';
import { CurrentAbility } from '@/common/authz/check-ability.decorator';
import { ApiProblemResponses } from '@/common/http/api-problem-response.decorator';
import { UuidPipe } from '@/common/http/uuid.pipe';
import {
  AttendeeInputDto,
  CreateTrainingRequestDto,
  LinkAttachmentsDto,
  ListRequestsQueryDto,
  TrainingAttachmentDto,
  TrainingAttendeeDto,
  TrainingPreviewDto,
  TrainingPreviewRequestDto,
  TrainingRequestDetailDto,
  TrainingRequestPageDto,
  TrainingTimelineEntryDto,
  UpdateBackOfficeDto,
  UpdateTrainingRequestDto,
} from '../dto/training-request.dto';
import { TrainingRequestsService } from '../services/training-requests.service';

/** `/training/requests*` (API.md §4.1). Static paths are registered before `/:id` (SPEC_RESOLUTIONS #30). */
@ApiTags('training')
@Controller('training/requests')
export class TrainingRequestsController {
  constructor(private readonly requests: TrainingRequestsService) {}

  @Get()
  @ApiOperation({ summary: 'Requests I created (scope=created) or all requests (scope=all, training office)' })
  @ZodResponse({ type: TrainingRequestPageDto })
  @ApiProblemResponses(403, 422)
  list(
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
    @Query() query: ListRequestsQueryDto,
  ): Promise<TrainingRequestPageDto> {
    return this.requests.list(user, ability, query);
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Routing preview for the stepper: approvers, auto-approvals, executive step' })
  @ZodResponse({ type: TrainingPreviewDto, status: 200 })
  @ApiProblemResponses(422)
  preview(
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
    @Body() body: TrainingPreviewRequestDto,
  ): Promise<TrainingPreviewDto> {
    return this.requests.preview(user, ability, body);
  }

  @Post()
  @ApiOperation({ summary: 'Create a training request with 1-20 attendees' })
  @ZodResponse({ type: TrainingRequestDetailDto, status: 201 })
  @ApiProblemResponses(422)
  async create(
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
    @Body() body: CreateTrainingRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TrainingRequestDetailDto> {
    const detail = await this.requests.create(user, ability, body);
    res.setHeader('Location', `/api/v1/training/requests/${detail.id}`);
    return detail;
  }

  @Get(':id')
  @ZodResponse({ type: TrainingRequestDetailDto })
  @ApiProblemResponses(404)
  detail(
    @Param('id', UuidPipe) id: string,
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
  ): Promise<TrainingRequestDetailDto> {
    return this.requests.detail(id, user, ability);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit request details (requester while all attendees await the manager; training office)' })
  @ZodResponse({ type: TrainingRequestDetailDto })
  @ApiProblemResponses(403, 404, 409, 422)
  update(
    @Param('id', UuidPipe) id: string,
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
    @Body() body: UpdateTrainingRequestDto,
  ): Promise<TrainingRequestDetailDto> {
    return this.requests.update(id, user, ability, body);
  }

  @Patch(':id/back-office')
  @ApiOperation({ summary: 'Billing status, actual cost and back-office comment (training office)' })
  @ZodResponse({ type: TrainingRequestDetailDto })
  @ApiProblemResponses(403, 404, 409, 422)
  updateBackOffice(
    @Param('id', UuidPipe) id: string,
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
    @Body() body: UpdateBackOfficeDto,
  ): Promise<TrainingRequestDetailDto> {
    return this.requests.updateBackOffice(id, user, ability, body);
  }

  @Post(':id/attendees')
  @ApiOperation({ summary: 'Add an attendee (before the start)' })
  @ZodResponse({ type: TrainingAttendeeDto, status: 201 })
  @ApiProblemResponses(403, 404, 409, 422)
  async addAttendee(
    @Param('id', UuidPipe) id: string,
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
    @Body() body: AttendeeInputDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TrainingAttendeeDto> {
    const attendee = await this.requests.addAttendee(id, user, ability, body);
    res.setHeader('Location', `/api/v1/training/participations/${attendee.id}`);
    return attendee;
  }

  @Post(':id/attachments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Link staged documents (purpose training_document); returns all request documents' })
  @ZodResponse({ type: [TrainingAttachmentDto], status: 200 })
  @ApiProblemResponses(403, 404, 422)
  addAttachments(
    @Param('id', UuidPipe) id: string,
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
    @Body() body: LinkAttachmentsDto,
  ): Promise<TrainingAttachmentDto[]> {
    return this.requests.addAttachments(id, user, ability, body.attachmentIds);
  }

  @Delete(':id/attachments/:attachmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Document removed' })
  @ApiProblemResponses(403, 404)
  async removeAttachment(
    @Param('id', UuidPipe) id: string,
    @Param('attachmentId', UuidPipe) attachmentId: string,
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
  ): Promise<void> {
    await this.requests.removeAttachment(id, attachmentId, user, ability);
  }

  @Get(':id/timeline')
  @ApiOperation({ summary: 'Audit timeline of the request and the attendees visible to the viewer' })
  @ZodResponse({ type: [TrainingTimelineEntryDto] })
  @ApiProblemResponses(404)
  timeline(
    @Param('id', UuidPipe) id: string,
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
  ): Promise<TrainingTimelineEntryDto[]> {
    return this.requests.timeline(id, user, ability);
  }
}
