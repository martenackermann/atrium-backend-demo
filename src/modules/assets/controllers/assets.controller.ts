import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBody, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '@/common/auth/auth-user';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import type { AppAbility } from '@/common/authz/ability.types';
import { CheckAbility, CurrentAbility } from '@/common/authz/check-ability.decorator';
import { ApiProblemResponses } from '@/common/http/api-problem-response.decorator';
import { UuidPipe } from '@/common/http/uuid.pipe';
import { WorkflowService } from '@/modules/core/workflow/workflow.service';
import {
  AssetAssignmentDto,
  AssetDashboardDto,
  AssetDto,
  AssetPageDto,
  AssetQueueCountsDto,
  AssetTimelineEntryDto,
  CreateAssetDto,
  ExportAssetsQuery,
  ListAssetsQuery,
  MyAssetsDto,
  UpdateAssetDto,
} from '../dto/asset.dto';
import { AssetWorkflow } from '../machines/asset.workflow';
import { AssetDashboardService } from '../services/asset-dashboard.service';
import { AssetsService } from '../services/assets.service';

/**
 * `/assets` (API.md §6.1). Static paths (`mine`, `dashboard`, `queues/counts`, `export.csv`) are
 * declared before the `:id` routes (SPEC_RESOLUTIONS #30).
 */
@ApiTags('assets')
@ApiProblemResponses(401)
@Controller('assets')
export class AssetsController {
  constructor(
    private readonly assets: AssetsService,
    private readonly dashboards: AssetDashboardService,
    private readonly workflows: WorkflowService,
    private readonly workflow: AssetWorkflow,
  ) {}

  // --- static paths ------------------------------------------------------------------

  @Get('mine')
  @ApiOperation({ summary: 'My devices: waiting for my acceptance, and in use / in repair' })
  @ZodResponse({ type: MyAssetsDto })
  mine(@CurrentUser() user: AuthUser, @CurrentAbility() ability: AppAbility): Promise<MyAssetsDto> {
    return this.assets.mine(user, ability);
  }

  @Get('dashboard')
  @CheckAbility('read', 'AssetDashboard')
  @ApiOperation({ summary: 'Asset admin dashboard' })
  @ZodResponse({ type: AssetDashboardDto })
  dashboard(@CurrentUser() user: AuthUser, @CurrentAbility() ability: AppAbility): Promise<AssetDashboardDto> {
    return this.dashboards.dashboard(user, ability);
  }

  @Get('queues/counts')
  @ApiOperation({ summary: 'Badge counts (mine for everyone, admin for asset_admin / it_admin)' })
  @ZodResponse({ type: AssetQueueCountsDto })
  counts(@CurrentUser() user: AuthUser): Promise<AssetQueueCountsDto> {
    return this.dashboards.counts(user);
  }

  @Get('export.csv')
  @CheckAbility('export', 'Asset')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="assets.csv"')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'CSV export with the list filters' })
  @ApiOkResponse({ content: { 'text/csv': { schema: { type: 'string' } } } })
  @ApiProblemResponses(422)
  exportCsv(@Query() query: ExportAssetsQuery): Promise<string> {
    return this.assets.exportCsv(query);
  }

  // --- collection ----------------------------------------------------------------

  @Get()
  @CheckAbility((ability) => ability.can('update', 'Asset'))
  @ApiOperation({ summary: 'Inventory (asset_admin, it_admin)' })
  @ZodResponse({ type: AssetPageDto })
  @ApiProblemResponses(422)
  list(
    @Query() query: ListAssetsQuery,
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
  ): Promise<AssetPageDto> {
    return this.assets.list(query, user, ability);
  }

  @Post()
  @CheckAbility('create', 'Asset')
  @ApiOperation({ summary: 'Add an asset (optionally assign it right away)' })
  @ZodResponse({ type: AssetDto, status: 201 })
  @ApiProblemResponses(409, 422)
  async create(
    @Body() dto: CreateAssetDto,
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AssetDto> {
    const view = await this.assets.create(dto, user, ability);
    res.location(`/api/v1/assets/${view.id}`);
    return view;
  }

  // --- one asset ---------------------------------------------------------------------

  @Get(':id')
  @ZodResponse({ type: AssetDto })
  @ApiProblemResponses(404)
  detail(
    @Param('id', UuidPipe) id: string,
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
  ): Promise<AssetDto> {
    return this.assets.detail(id, user, ability);
  }

  @Patch(':id')
  @CheckAbility('update', 'Asset')
  @ApiOperation({ summary: 'Edit fields (audited with a field diff)' })
  @ZodResponse({ type: AssetDto })
  @ApiProblemResponses(404, 409, 422)
  update(
    @Param('id', UuidPipe) id: string,
    @Body() dto: UpdateAssetDto,
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
  ): Promise<AssetDto> {
    return this.assets.update(id, dto, user, ability);
  }

  @Delete(':id')
  @CheckAbility('delete', 'Asset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Asset soft-deleted' })
  @ApiProblemResponses(404, 409)
  async remove(
    @Param('id', UuidPipe) id: string,
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
  ): Promise<void> {
    await this.assets.remove(id, user, ability);
  }

  @Post(':id/actions/:action')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Run a lifecycle action',
    description:
      'assign {userId, note?} · accept {platformId?} · decline {reason} · unassign {reason?} · return {condition, note?} · send_to_repair {note} · complete_repair {note?} · scrap {reason}',
  })
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  @ZodResponse({ type: AssetDto })
  @ApiProblemResponses(403, 404, 409, 422)
  async act(
    @Param('id', UuidPipe) id: string,
    @Param('action') action: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
  ): Promise<AssetDto> {
    const result = await this.workflows.apply(this.workflow.definition, {
      id,
      action,
      actor: user,
      ability,
      input: body,
    });
    // Built from the transitioned row: after `decline` the user no longer sees the asset, but the
    // response still describes the result of their action (API.md §1 Transitions -> 200 + detail).
    return this.assets.toDto(result.entity, user, ability);
  }

  @Get(':id/assignments')
  @ApiOperation({ summary: 'Assignment history, newest first (admins)' })
  @ZodResponse({ type: [AssetAssignmentDto] })
  @ApiProblemResponses(403, 404)
  assignments(@Param('id', UuidPipe) id: string, @CurrentUser() user: AuthUser): Promise<AssetAssignmentDto[]> {
    return this.assets.assignments(id, user);
  }

  @Get(':id/timeline')
  @ApiOperation({ summary: 'Timeline with field diffs and cost-centre syncs, oldest first (admins)' })
  @ZodResponse({ type: [AssetTimelineEntryDto] })
  @ApiProblemResponses(403, 404)
  timeline(@Param('id', UuidPipe) id: string, @CurrentUser() user: AuthUser): Promise<AssetTimelineEntryDto[]> {
    return this.assets.timeline(id, user);
  }
}
