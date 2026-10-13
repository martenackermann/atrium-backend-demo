import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '@/common/auth/auth-user';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { CheckAbility } from '@/common/authz/check-ability.decorator';
import { ApiProblemResponses } from '@/common/http/api-problem-response.decorator';
import { pageMeta, toSkipTake } from '@/common/http/pagination';
import { UuidPipe } from '@/common/http/uuid.pipe';
import { addDaysIso, startOfDayInZone } from '@/common/time/time';
import { Clock } from '@/common/time/clock.service';
import { PrismaService } from '@/database/prisma.service';
import type { Prisma } from '@/generated/prisma/client';
import { toPrismaOrderBy } from '@/common/http/sort';
import type { ModuleName } from '@/common/domain/vocabulary';
import { AuditService } from '../audit/audit.service';
import { JobRegistry, toJobRunDto } from '../jobs/job.registry';
import {
  AdminUserDto,
  AdminUserPageDto,
  AuditEntryPageDto,
  CreateAdminUserDto,
  JobDto,
  JobRunPageDto,
  JobRunStartedDto,
  ListAdminUsersQuery,
  ListAuditQuery,
  UpdateAdminUserDto,
} from './admin.dto';
import { AdminUsersService } from './admin-users.service';
import { paginationQuerySchema } from '@/common/http/pagination';
import { createZodDto } from 'nestjs-zod';

class PageQuery extends createZodDto(paginationQuerySchema) {}

@ApiTags('admin')
@CheckAbility('manage', 'AdminConsole')
@ApiProblemResponses(401, 403)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly jobs: JobRegistry,
    private readonly prisma: PrismaService,
  ) {}

  @Get('users')
  @ZodResponse({ type: AdminUserPageDto })
  listUsers(@Query() query: ListAdminUsersQuery): Promise<AdminUserPageDto> {
    return this.users.list(query);
  }

  @Post('users')
  @ZodResponse({ type: AdminUserDto, status: 201 })
  @ApiProblemResponses(409, 422)
  createUser(@CurrentUser() user: AuthUser, @Body() dto: CreateAdminUserDto): Promise<AdminUserDto> {
    return this.users.create(user, dto);
  }

  @Get('users/:id')
  @ZodResponse({ type: AdminUserDto })
  @ApiProblemResponses(404)
  getUser(@Param('id', UuidPipe) id: string): Promise<AdminUserDto> {
    return this.users.get(id);
  }

  @Patch('users/:id')
  @ZodResponse({ type: AdminUserDto })
  @ApiProblemResponses(404, 409, 422)
  updateUser(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body() dto: UpdateAdminUserDto,
  ): Promise<AdminUserDto> {
    return this.users.update(user, id, dto);
  }

  @Get('jobs')
  @ZodResponse({ type: [JobDto] })
  listJobs(): Promise<JobDto[]> {
    return this.jobs.describeAll();
  }

  @Get('jobs/:name/runs')
  @ZodResponse({ type: JobRunPageDto })
  @ApiProblemResponses(404)
  async jobRuns(@Param('name') name: string, @Query() query: PageQuery): Promise<JobRunPageDto> {
    this.jobs.require(name);
    const where = { jobName: name };
    const [rows, total] = await Promise.all([
      this.prisma.jobRun.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        include: { triggeredByUser: true },
        ...toSkipTake(query),
      }),
      this.prisma.jobRun.count({ where }),
    ]);
    return { data: rows.map(toJobRunDto), meta: pageMeta(total, query) };
  }

  @Post('jobs/:name/run')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Run a job now (asynchronously)' })
  @ZodResponse({ type: JobRunStartedDto, status: 202 })
  @ApiProblemResponses(404)
  async runJob(@CurrentUser() user: AuthUser, @Param('name') name: string): Promise<JobRunStartedDto> {
    return { jobRunId: await this.jobs.trigger(name, user.id) };
  }
}

@ApiTags('admin')
@CheckAbility('read', 'AuditLog')
@ApiProblemResponses(401, 403)
@Controller('audit')
export class AuditController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Global audit log (it_admin)' })
  @ZodResponse({ type: AuditEntryPageDto })
  @ApiProblemResponses(422)
  async list(@Query() query: ListAuditQuery): Promise<AuditEntryPageDto> {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.module ? { module: query.module } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.actingAs ? { actingAs: query.actingAs } : {}),
      ...(query.from || query.to
        ? {
            occurredAt: {
              // inclusive IsoDates in APP_TIMEZONE
              ...(query.from ? { gte: startOfDayInZone(query.from, this.clock.timeZone) } : {}),
              ...(query.to ? { lt: startOfDayInZone(addDaysIso(query.to, 1), this.clock.timeZone) } : {}),
            },
          }
        : {}),
    };
    const orderBy = [...toPrismaOrderBy(query.sort), { id: 'desc' }] as Prisma.AuditLogOrderByWithRelationInput[];
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy, include: { actor: true }, ...toSkipTake(query) }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      data: rows.map((row) => ({
        ...this.audit.toTimelineEntry(row),
        module: row.module as ModuleName,
        correlationId: row.correlationId,
      })),
      meta: pageMeta(total, query),
    };
  }
}
