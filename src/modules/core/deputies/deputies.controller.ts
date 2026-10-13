import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '@/common/auth/auth-user';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { ApiProblemResponses } from '@/common/http/api-problem-response.decorator';
import { UuidPipe } from '@/common/http/uuid.pipe';
import { CreateDeputyDto, DeputyDto, MyDeputiesDto, UpdateDeputyDto } from './deputies.dto';
import { DeputiesService } from './deputies.service';

@ApiTags('me')
@Controller('me/deputies')
export class DeputiesController {
  constructor(private readonly deputies: DeputiesService) {}

  @Get()
  @ApiOperation({ summary: 'My deputies, and whom I stand in for' })
  @ZodResponse({ type: MyDeputiesDto })
  list(@CurrentUser() user: AuthUser): Promise<MyDeputiesDto> {
    return this.deputies.mine(user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Name a deputy (managers and executives)' })
  @ZodResponse({ type: DeputyDto, status: 201 })
  @ApiProblemResponses(403, 409, 422)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDeputyDto): Promise<DeputyDto> {
    return this.deputies.create(user, dto);
  }

  @Patch(':id')
  @ZodResponse({ type: DeputyDto })
  @ApiProblemResponses(404, 409, 422)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body() dto: UpdateDeputyDto,
  ): Promise<DeputyDto> {
    return this.deputies.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Deputy removed' })
  @ApiProblemResponses(404)
  async remove(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string): Promise<void> {
    await this.deputies.remove(user, id);
  }
}
