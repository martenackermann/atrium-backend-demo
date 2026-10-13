import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '@/common/auth/auth-user';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { CheckAbility } from '@/common/authz/check-ability.decorator';
import { ApiProblemResponses } from '@/common/http/api-problem-response.decorator';
import { UuidPipe } from '@/common/http/uuid.pipe';
import {
  AssetModelDto,
  AssetModelPageDto,
  CatalogFilterQuery,
  CreateDeviceTypeDto,
  CreateManufacturerDto,
  CreateModelDto,
  CreatePlatformDto,
  DeviceTypeDto,
  ListModelsQuery,
  ManufacturerDto,
  PlatformDto,
  UpdateDeviceTypeDto,
  UpdateManufacturerDto,
  UpdateModelDto,
  UpdatePlatformDto,
} from '../dto/catalog.dto';
import { CatalogService } from '../services/catalog.service';

const API_BASE = '/api/v1/assets/catalog';

/** `/assets/catalog/*` (API.md §6.1). Everyone reads the catalogue; asset_admin and it_admin manage it. */
@ApiTags('assets')
@ApiProblemResponses(401)
@Controller('assets/catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  // --- device types --------------------------------------------------------------

  @Get('device-types')
  @ApiOperation({ summary: 'Device types (laptop, monitor, ...)' })
  @ZodResponse({ type: [DeviceTypeDto] })
  deviceTypes(): Promise<DeviceTypeDto[]> {
    return this.catalog.deviceTypes();
  }

  @Post('device-types')
  @CheckAbility('create', 'AssetCatalog')
  @ZodResponse({ type: DeviceTypeDto, status: 201 })
  @ApiProblemResponses(422)
  async createDeviceType(
    @Body() dto: CreateDeviceTypeDto,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DeviceTypeDto> {
    const view = await this.catalog.createDeviceType(dto, user);
    res.location(`${API_BASE}/device-types/${view.id}`);
    return view;
  }

  @Patch('device-types/:id')
  @CheckAbility('update', 'AssetCatalog')
  @ZodResponse({ type: DeviceTypeDto })
  @ApiProblemResponses(404, 422)
  updateDeviceType(
    @Param('id', UuidPipe) id: string,
    @Body() dto: UpdateDeviceTypeDto,
    @CurrentUser() user: AuthUser,
  ): Promise<DeviceTypeDto> {
    return this.catalog.updateDeviceType(id, dto, user);
  }

  @Delete('device-types/:id')
  @CheckAbility('delete', 'AssetCatalog')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Device type deleted' })
  @ApiProblemResponses(404, 409)
  async deleteDeviceType(@Param('id', UuidPipe) id: string, @CurrentUser() user: AuthUser): Promise<void> {
    await this.catalog.deleteDeviceType(id, user);
  }

  // --- manufacturers ---------------------------------------------------------------

  @Get('manufacturers')
  @ApiOperation({ summary: 'Manufacturers and the device types they make' })
  @ZodResponse({ type: [ManufacturerDto] })
  @ApiProblemResponses(422)
  manufacturers(@Query() query: CatalogFilterQuery): Promise<ManufacturerDto[]> {
    return this.catalog.manufacturers(query);
  }

  @Post('manufacturers')
  @CheckAbility('create', 'AssetCatalog')
  @ZodResponse({ type: ManufacturerDto, status: 201 })
  @ApiProblemResponses(422)
  async createManufacturer(
    @Body() dto: CreateManufacturerDto,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ManufacturerDto> {
    const view = await this.catalog.createManufacturer(dto, user);
    res.location(`${API_BASE}/manufacturers/${view.id}`);
    return view;
  }

  @Patch('manufacturers/:id')
  @CheckAbility('update', 'AssetCatalog')
  @ZodResponse({ type: ManufacturerDto })
  @ApiProblemResponses(404, 422)
  updateManufacturer(
    @Param('id', UuidPipe) id: string,
    @Body() dto: UpdateManufacturerDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ManufacturerDto> {
    return this.catalog.updateManufacturer(id, dto, user);
  }

  // --- platforms -------------------------------------------------------------------

  @Get('platforms')
  @ApiOperation({ summary: 'Platforms (operating systems) and their device types' })
  @ZodResponse({ type: [PlatformDto] })
  @ApiProblemResponses(422)
  platforms(@Query() query: CatalogFilterQuery): Promise<PlatformDto[]> {
    return this.catalog.platforms(query);
  }

  @Post('platforms')
  @CheckAbility('create', 'AssetCatalog')
  @ZodResponse({ type: PlatformDto, status: 201 })
  @ApiProblemResponses(422)
  async createPlatform(
    @Body() dto: CreatePlatformDto,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PlatformDto> {
    const view = await this.catalog.createPlatform(dto, user);
    res.location(`${API_BASE}/platforms/${view.id}`);
    return view;
  }

  @Patch('platforms/:id')
  @CheckAbility('update', 'AssetCatalog')
  @ZodResponse({ type: PlatformDto })
  @ApiProblemResponses(404, 422)
  updatePlatform(
    @Param('id', UuidPipe) id: string,
    @Body() dto: UpdatePlatformDto,
    @CurrentUser() user: AuthUser,
  ): Promise<PlatformDto> {
    return this.catalog.updatePlatform(id, dto, user);
  }

  // --- models ------------------------------------------------------------------------

  @Get('models')
  @ApiOperation({ summary: 'Asset models (paged)' })
  @ZodResponse({ type: AssetModelPageDto })
  @ApiProblemResponses(422)
  models(@Query() query: ListModelsQuery): Promise<AssetModelPageDto> {
    return this.catalog.models(query);
  }

  @Post('models')
  @CheckAbility('create', 'AssetCatalog')
  @ZodResponse({ type: AssetModelDto, status: 201 })
  @ApiProblemResponses(422)
  async createModel(
    @Body() dto: CreateModelDto,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AssetModelDto> {
    const view = await this.catalog.createModel(dto, user);
    res.location(`${API_BASE}/models/${view.id}`);
    return view;
  }

  @Patch('models/:id')
  @CheckAbility('update', 'AssetCatalog')
  @ZodResponse({ type: AssetModelDto })
  @ApiProblemResponses(404, 422)
  updateModel(
    @Param('id', UuidPipe) id: string,
    @Body() dto: UpdateModelDto,
    @CurrentUser() user: AuthUser,
  ): Promise<AssetModelDto> {
    return this.catalog.updateModel(id, dto, user);
  }

  @Delete('models/:id')
  @CheckAbility('delete', 'AssetCatalog')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Model deleted' })
  @ApiProblemResponses(404, 409)
  async deleteModel(@Param('id', UuidPipe) id: string, @CurrentUser() user: AuthUser): Promise<void> {
    await this.catalog.deleteModel(id, user);
  }
}
