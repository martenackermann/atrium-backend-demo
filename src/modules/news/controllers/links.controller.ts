import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '@/common/auth/auth-user';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { CheckAbility } from '@/common/authz';
import { ApiProblemResponses } from '@/common/http/api-problem-response.decorator';
import { UuidPipe } from '@/common/http/uuid.pipe';
import {
  ListLinksQuery,
  ReorderLinksDto,
  UpdateUsefulLinkDto,
  UsefulLinkDto,
  UsefulLinkInputDto,
} from '../dto/links.dto';
import { LinksService } from '../services/links.service';

@ApiTags('links')
@ApiProblemResponses(401)
@Controller('links')
export class LinksController {
  constructor(private readonly links: LinksService) {}

  @Get()
  @ApiOperation({ summary: 'Useful links in display order (includeInactive for editors)' })
  @ZodResponse({ type: [UsefulLinkDto] })
  list(@CurrentUser() user: AuthUser, @Query() query: ListLinksQuery): Promise<UsefulLinkDto[]> {
    return this.links.list(user, query.includeInactive);
  }

  // Static path before /:id (SPEC_RESOLUTIONS #30).
  @Put('order')
  @CheckAbility('reorder', 'UsefulLink')
  @ApiOperation({ summary: 'Reorder: all link ids in the new order' })
  @ZodResponse({ type: [UsefulLinkDto] })
  @ApiProblemResponses(422)
  reorder(@CurrentUser() user: AuthUser, @Body() dto: ReorderLinksDto): Promise<UsefulLinkDto[]> {
    return this.links.reorder(user, dto.ids);
  }

  @Post()
  @CheckAbility('create', 'UsefulLink')
  @ZodResponse({ type: UsefulLinkDto, status: 201 })
  @ApiProblemResponses(422)
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: UsefulLinkInputDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UsefulLinkDto> {
    const link = await this.links.create(user, dto);
    res.location(`/api/v1/links/${link.id}`);
    return link;
  }

  @Patch(':id')
  @CheckAbility('update', 'UsefulLink')
  @ZodResponse({ type: UsefulLinkDto })
  @ApiProblemResponses(404, 422)
  update(
    @Param('id', UuidPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateUsefulLinkDto,
  ): Promise<UsefulLinkDto> {
    return this.links.update(user, id, dto);
  }

  @Delete(':id')
  @CheckAbility('delete', 'UsefulLink')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Link deleted' })
  @ApiProblemResponses(404)
  async remove(@Param('id', UuidPipe) id: string, @CurrentUser() user: AuthUser): Promise<void> {
    await this.links.remove(user, id);
  }
}
