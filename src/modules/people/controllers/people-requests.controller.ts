import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '@/common/auth/auth-user';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { type AppAbility, CurrentAbility } from '@/common/authz';
import { ApiProblemResponses } from '@/common/http/api-problem-response.decorator';
import { UuidPipe } from '@/common/http/uuid.pipe';
import { WorkflowService } from '@/modules/core/workflow';
import {
  CreatePeopleCommentDto,
  CreatePeopleRequestDto,
  ListPeopleRequestsQuery,
  PeopleCommentDto,
  PeopleRequestDetailDto,
  PeopleRequestPageDto,
  UpdatePeopleRequestDto,
} from '../dto/people-request.dto';
import { TimelineDto } from '../dto/timeline.dto';
import { PeopleRequestWorkflow } from '../machines/people-request.workflow';
import { PeopleRequestsService } from '../services/people-requests.service';

@ApiTags('people')
@ApiProblemResponses(401)
@Controller('people/requests')
export class PeopleRequestsController {
  constructor(
    private readonly requests: PeopleRequestsService,
    private readonly workflows: WorkflowService,
    private readonly workflow: PeopleRequestWorkflow,
  ) {}

  @Get()
  @ApiOperation({ summary: 'People requests (scope=mine: requester, manager or deputy; scope=all: People Ops)' })
  @ZodResponse({ type: PeopleRequestPageDto })
  @ApiProblemResponses(403, 422)
  list(
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
    @Query() query: ListPeopleRequestsQuery,
  ): Promise<PeopleRequestPageDto> {
    return this.requests.list(user, ability, query);
  }

  @Post()
  @ApiOperation({ summary: 'Create an onboarding, offboarding or role change request' })
  @ZodResponse({ type: PeopleRequestDetailDto, status: 201 })
  @ApiProblemResponses(422)
  async create(
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
    @Body() dto: CreatePeopleRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PeopleRequestDetailDto> {
    const row = await this.requests.create(user, dto);
    res.location(`/api/v1/people/requests/${row.id}`);
    return this.requests.toDetail(row, user, ability);
  }

  @Get(':id')
  @ZodResponse({ type: PeopleRequestDetailDto })
  @ApiProblemResponses(404)
  detail(
    @Param('id', UuidPipe) id: string,
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
  ): Promise<PeopleRequestDetailDto> {
    return this.requests.detail(id, user, ability);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit fields (requester while open; People Ops until closed) or internal fields' })
  @ZodResponse({ type: PeopleRequestDetailDto })
  @ApiProblemResponses(403, 404, 409, 422)
  async update(
    @Param('id', UuidPipe) id: string,
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
    @Body() dto: UpdatePeopleRequestDto,
  ): Promise<PeopleRequestDetailDto> {
    const row = await this.requests.update(user, id, dto);
    return this.requests.toDetail(row, user, ability);
  }

  @Post(':id/actions/:action')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Workflow action: start_work, wait_internal, wait_on_requester, resume, complete, reject, cancel, reopen',
  })
  @ApiBody({ required: false, schema: { type: 'object' } })
  @ZodResponse({ type: PeopleRequestDetailDto })
  @ApiProblemResponses(403, 404, 409, 422)
  async act(
    @Param('id', UuidPipe) id: string,
    @Param('action') action: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
  ): Promise<PeopleRequestDetailDto> {
    await this.workflows.apply(this.workflow.definition, { id, action, actor: user, ability, input: body });
    return this.requests.detail(id, user, ability);
  }

  @Get(':id/comments')
  @ApiOperation({ summary: 'Conversation, oldest first (internal comments only for People Ops)' })
  @ZodResponse({ type: [PeopleCommentDto] })
  @ApiProblemResponses(404)
  comments(@Param('id', UuidPipe) id: string, @CurrentUser() user: AuthUser): Promise<PeopleCommentDto[]> {
    return this.requests.comments(id, user);
  }

  @Post(':id/comments')
  @ApiOperation({ summary: 'Add a comment; a requester reply while waiting moves the request back to In progress' })
  @ZodResponse({ type: PeopleCommentDto, status: 201 })
  @ApiProblemResponses(403, 404, 409, 422)
  addComment(
    @Param('id', UuidPipe) id: string,
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
    @Body() dto: CreatePeopleCommentDto,
  ): Promise<PeopleCommentDto> {
    return this.requests.addComment(id, user, ability, dto);
  }

  @Get(':id/timeline')
  @ZodResponse({ type: [TimelineDto] })
  @ApiProblemResponses(404)
  timeline(@Param('id', UuidPipe) id: string, @CurrentUser() user: AuthUser): Promise<TimelineDto[]> {
    return this.requests.timeline(id, user);
  }
}
