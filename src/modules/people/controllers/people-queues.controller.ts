import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '@/common/auth/auth-user';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { ApiProblemResponses } from '@/common/http/api-problem-response.decorator';
import { PeopleQueueCountsDto } from '../dto/people-request.dto';
import { PeopleRequestsService } from '../services/people-requests.service';

@ApiTags('people')
@ApiProblemResponses(401)
@Controller('people/queues')
export class PeopleQueuesController {
  constructor(private readonly requests: PeopleRequestsService) {}

  @Get('counts')
  @ApiOperation({ summary: 'Badge and queue counts (ops = null unless People Ops / IT admin)' })
  @ZodResponse({ type: PeopleQueueCountsDto })
  counts(@CurrentUser() user: AuthUser): Promise<PeopleQueueCountsDto> {
    return this.requests.queueCounts(user);
  }
}
