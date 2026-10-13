import { Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '@/common/auth/auth-user';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { CheckAbility } from '@/common/authz/check-ability.decorator';
import { ApiProblemResponses } from '@/common/http/api-problem-response.decorator';
import { UuidPipe } from '@/common/http/uuid.pipe';
import {
  CarRentalClassDto,
  CarRentalClassListDto,
  CreateCarClassDto,
  ListCarClassesQuery,
  UpdateCarClassDto,
} from '../dto/car-class.dto';
import { TravelCountsDto } from '../dto/travel-request.dto';
import { CarClassesService } from '../services/car-classes.service';
import { TravelRequestsService } from '../services/travel-requests.service';

@ApiTags('travel')
@Controller('travel/queues')
export class TravelQueuesController {
  constructor(private readonly travel: TravelRequestsService) {}

  @Get('counts')
  @ApiOperation({ summary: 'Badge counts: my active trips, approvals, desk queues' })
  @ZodResponse({ type: TravelCountsDto })
  counts(@CurrentUser() user: AuthUser): Promise<TravelCountsDto> {
    return this.travel.counts(user);
  }
}

@ApiTags('travel')
@Controller('travel/car-classes')
export class CarClassesController {
  constructor(private readonly classes: CarClassesService) {}

  @Get()
  @ApiOperation({ summary: 'Car-rental classes (active; includeInactive for the desk), sortOrder' })
  @ZodResponse({ type: CarRentalClassListDto })
  list(@CurrentUser() user: AuthUser, @Query() query: ListCarClassesQuery): Promise<CarRentalClassListDto> {
    return this.classes.list(user, query);
  }

  @Post()
  @CheckAbility('create', 'CarRentalClass')
  @ZodResponse({ type: CarRentalClassDto, status: 201 })
  @ApiProblemResponses(409, 422)
  async create(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateCarClassDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CarRentalClassDto> {
    const row = await this.classes.create(user, body);
    res.location(`/api/v1/travel/car-classes/${row.id}`);
    return row;
  }

  @Patch(':id')
  @CheckAbility('update', 'CarRentalClass')
  @ZodResponse({ type: CarRentalClassDto })
  @ApiProblemResponses(404, 409, 422)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body() body: UpdateCarClassDto,
  ): Promise<CarRentalClassDto> {
    return this.classes.update(user, id, body);
  }
}
