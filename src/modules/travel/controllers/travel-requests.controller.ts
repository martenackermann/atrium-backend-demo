import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '@/common/auth/auth-user';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import type { AppAbility } from '@/common/authz/ability.types';
import { CurrentAbility } from '@/common/authz/check-ability.decorator';
import { ApiProblemResponses } from '@/common/http/api-problem-response.decorator';
import { UuidPipe } from '@/common/http/uuid.pipe';
import { AppValidationPipe } from '@/common/http/validation';
import { Clock } from '@/common/time/clock.service';
import {
  CreateTravelRequestDto,
  type CreateTravelRequestInput,
  ExportTravelQuery,
  ListTravelQuery,
  TravelPinDto,
  TravelPreviewDto,
  TravelPreviewRequestDto,
  TravelRequestDetailDto,
  TravelRequestPageDto,
  TravelTimelineDto,
} from '../dto/travel-request.dto';
import { TravelRequestsService } from '../services/travel-requests.service';

/**
 * `/travel/requests*` (API.md §5.1). Static paths (`export.csv`, `preview`) are declared
 * before the `/:id` routes (SPEC_RESOLUTIONS #30).
 */
@ApiTags('travel')
@Controller('travel/requests')
export class TravelRequestsController {
  constructor(
    private readonly travel: TravelRequestsService,
    private readonly clock: Clock,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Travel requests by scope (mine | approvals | deputy | team | all)' })
  @ZodResponse({ type: TravelRequestPageDto })
  @ApiProblemResponses(403, 422)
  list(
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
    @Query() query: ListTravelQuery,
  ): Promise<TravelRequestPageDto> {
    return this.travel.list(user, ability, query);
  }

  @Get('export.csv')
  @ApiOperation({ summary: 'CSV export of all requests (travel desk, it_admin)' })
  @ApiProduces('text/csv')
  @ApiOkResponse({ description: 'CSV with BOM', content: { 'text/csv': { schema: { type: 'string' } } } })
  @ApiProblemResponses(403, 422)
  async exportCsv(
    @CurrentUser() user: AuthUser,
    @Query() query: ExportTravelQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const csv = await this.travel.exportCsv(user, query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="travel-requests-${this.clock.today()}.csv"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return csv;
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'needsApproval, reasons and approver candidates for a (partial) draft' })
  @ApiBody({ type: TravelPreviewRequestDto })
  @ZodResponse({ type: TravelPreviewDto, status: 200 })
  @ApiProblemResponses(422)
  preview(@CurrentUser() user: AuthUser, @Body() body: TravelPreviewRequestDto): Promise<TravelPreviewDto> {
    return this.travel.preview(user, body);
  }

  @Post()
  @ApiOperation({ summary: 'Submit a car, train or flight request' })
  @ApiBody({ type: CreateTravelRequestDto })
  @ZodResponse({ type: TravelRequestDetailDto, status: 201 })
  @ApiProblemResponses(422)
  async create(
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
    @Body(new AppValidationPipe(CreateTravelRequestDto)) body: CreateTravelRequestInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TravelRequestDetailDto> {
    const detail = await this.travel.create(user, ability, body);
    res.location(`/api/v1/travel/requests/${detail.id}`);
    return detail;
  }

  @Get(':id')
  @ZodResponse({ type: TravelRequestDetailDto })
  @ApiProblemResponses(404)
  detail(
    @Param('id', UuidPipe) id: string,
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
  ): Promise<TravelRequestDetailDto> {
    return this.travel.detail(id, user, ability);
  }

  @Post(':id/actions/:action')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Workflow action: approve, decline, withdraw, request_cancellation, confirm_cancellation, reject_cancellation, book, mark_booking_impossible, retry_booking, close',
  })
  @ApiBody({ schema: { type: 'object', description: 'Action body (API.md §5.3)' } })
  @ZodResponse({ type: TravelRequestDetailDto, status: 200 })
  @ApiProblemResponses(403, 404, 409, 422)
  act(
    @Param('id', UuidPipe) id: string,
    @Param('action') action: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @CurrentAbility() ability: AppAbility,
  ): Promise<TravelRequestDetailDto> {
    return this.travel.act(id, action, body, user, ability);
  }

  @Get(':id/booking/pin')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Reveal the booking PIN (traveller, requester, travel desk); audited as view_pin' })
  @ZodResponse({ type: TravelPinDto })
  @ApiProblemResponses(403, 404)
  pin(@Param('id', UuidPipe) id: string, @CurrentUser() user: AuthUser): Promise<TravelPinDto> {
    return this.travel.pin(id, user);
  }

  @Get(':id/timeline')
  @ZodResponse({ type: TravelTimelineDto })
  @ApiProblemResponses(404)
  timeline(@Param('id', UuidPipe) id: string, @CurrentUser() user: AuthUser): Promise<TravelTimelineDto> {
    return this.travel.timeline(id, user);
  }
}
