import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '@/common/auth/auth-user';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { ApiProblemResponses } from '@/common/http/api-problem-response.decorator';
import { UuidPipe } from '@/common/http/uuid.pipe';
import { ApprovalService } from '../approvals/approval.service';
import { ApproverChainDto, ListUsersQuery, MeDto, UserProfileDto, UserSummaryPageDto } from './users.dto';
import { UsersService } from './users.service';

@ApiTags('me')
@Controller('me')
export class MeController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'The current user, with effective roles and active deputy assignments' })
  @ZodResponse({ type: MeDto })
  me(@CurrentUser() user: AuthUser): Promise<MeDto> {
    return this.users.me(user.id);
  }
}

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly approvals: ApprovalService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'User picker / directory search' })
  @ZodResponse({ type: UserSummaryPageDto })
  @ApiProblemResponses(422)
  list(@CurrentUser() user: AuthUser, @Query() query: ListUsersQuery): Promise<UserSummaryPageDto> {
    return this.users.list(user, query);
  }

  @Get(':id')
  @ZodResponse({ type: UserProfileDto })
  @ApiProblemResponses(404)
  profile(@Param('id', UuidPipe) id: string): Promise<UserProfileDto> {
    return this.users.profile(id);
  }

  @Get(':id/approvers')
  @ApiOperation({ summary: 'Approver chain of a user (SPEC §6.1), for approver selection' })
  @ZodResponse({ type: ApproverChainDto })
  @ApiProblemResponses(404)
  async approvers(@Param('id', UuidPipe) id: string): Promise<ApproverChainDto> {
    await this.users.assertExists(id);
    return this.approvals.approverChain(id);
  }
}
