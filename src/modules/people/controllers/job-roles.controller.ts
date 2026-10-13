import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '@/common/auth/auth-user';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { CheckAbility } from '@/common/authz';
import { ApiProblemResponses } from '@/common/http/api-problem-response.decorator';
import { UuidPipe } from '@/common/http/uuid.pipe';
import { CreateJobRoleDto, JobRoleDto, ListJobRolesQuery, UpdateJobRoleDto } from '../dto/job-role.dto';
import { JobRolesService } from '../services/job-roles.service';

@ApiTags('people')
@ApiProblemResponses(401)
@Controller('people/job-roles')
export class JobRolesController {
  constructor(private readonly roles: JobRolesService) {}

  @Get()
  @ApiOperation({ summary: 'Job-role catalogue (name order; includeInactive for People Ops)' })
  @ZodResponse({ type: [JobRoleDto] })
  list(@CurrentUser() user: AuthUser, @Query() query: ListJobRolesQuery): Promise<JobRoleDto[]> {
    return this.roles.list(user, query.includeInactive);
  }

  @Post()
  @CheckAbility('create', 'JobRole')
  @ZodResponse({ type: JobRoleDto, status: 201 })
  @ApiProblemResponses(409, 422)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateJobRoleDto): Promise<JobRoleDto> {
    return this.roles.create(user, dto);
  }

  @Patch(':id')
  @CheckAbility('update', 'JobRole')
  @ZodResponse({ type: JobRoleDto })
  @ApiProblemResponses(404, 409, 422)
  update(
    @Param('id', UuidPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateJobRoleDto,
  ): Promise<JobRoleDto> {
    return this.roles.update(user, id, dto);
  }
}
