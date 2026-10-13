import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '@/common/auth/auth-user';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { ApiProblemResponses } from '@/common/http/api-problem-response.decorator';
import { MyDayDto } from '../dto/my-day.dto';
import { HomeService } from '../services/home.service';

@ApiTags('home')
@ApiProblemResponses(401)
@Controller('home')
export class HomeController {
  constructor(private readonly home: HomeService) {}

  @Get('my-day')
  @ApiOperation({ summary: 'Home "My day": inbox head, upcoming trainings and trips, devices, news, links' })
  @ZodResponse({ type: MyDayDto })
  myDay(@CurrentUser() user: AuthUser): Promise<MyDayDto> {
    return this.home.myDay(user);
  }
}
