import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '@/common/auth/auth-user';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { Public } from '@/common/auth/public.decorator';
import { ApiProblemResponses } from '@/common/http/api-problem-response.decorator';
import { DemoLoginDto, LoginDto, LoginResponseDto, PersonaDto } from './auth.dto';
import { AuthService } from './auth.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Email + password login; returns a bearer token' })
  @ZodResponse({ type: LoginResponseDto, status: 200 })
  @ApiProblemResponses(401, 422, 429)
  login(@Body() dto: LoginDto, @Headers('user-agent') userAgent?: string): Promise<LoginResponseDto> {
    return this.auth.login(dto.email, dto.password, userAgent);
  }

  @Public()
  @Post('demo-login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'One-click persona login (only when DEMO_MODE=true)' })
  @ZodResponse({ type: LoginResponseDto, status: 200 })
  @ApiProblemResponses(404, 422, 429)
  demoLogin(@Body() dto: DemoLoginDto, @Headers('user-agent') userAgent?: string): Promise<LoginResponseDto> {
    return this.auth.demoLogin(dto.personaKey, userAgent);
  }

  @Public()
  @Get('personas')
  @ApiOperation({ summary: 'Demo personas for the login screen (only when DEMO_MODE=true)' })
  @ZodResponse({ type: [PersonaDto] })
  @ApiProblemResponses(404)
  personas(): Promise<PersonaDto[]> {
    return this.auth.personas();
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Session revoked' })
  @ApiProblemResponses(401)
  async logout(@CurrentUser() user: AuthUser): Promise<void> {
    await this.auth.logout(user.sessionId);
  }
}
