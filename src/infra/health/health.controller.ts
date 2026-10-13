import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Public } from '@/common/auth/public.decorator';
import { PrismaService } from '@/database/prisma.service';
import { MailTransport } from '@/infra/mail/mail-transport';
import { QueueService } from '@/infra/queue/queue.service';

const check = z.enum(['up', 'down']);
export const healthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.object({ database: check, queue: check, mail: check }),
});
export class HealthDto extends createZodDto(healthSchema) {}

/**
 * SMTP verification opens a fresh connection + EHLO each time, which can take seconds when the
 * mail server is busy (parallel test runs). So mail gets a longer timeout, and a successful check
 * is reused for a minute instead of reconnecting on every health request.
 */
const MAIL_TIMEOUT_MS = 5000;
const MAIL_UP_CACHE_MS = 60_000;

async function probe(fn: () => Promise<boolean>, timeoutMs = 2000): Promise<'up' | 'down'> {
  try {
    const ok = await Promise.race([
      fn(),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
    ]);
    return ok ? 'up' : 'down';
  } catch {
    return 'down';
  }
}

@ApiTags('system')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly mail: MailTransport,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Liveness/readiness: database, job queue and SMTP' })
  @ApiResponse({ status: 200, type: HealthDto, description: 'ok, or degraded when queue/mail are down' })
  @ApiResponse({ status: 503, type: HealthDto, description: 'The database is down' })
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthDto> {
    const [database, queue, mail] = await Promise.all([
      probe(async () => {
        await this.prisma.$queryRaw`SELECT 1`;
        return true;
      }),
      probe(() => this.queue.isHealthy()),
      this.probeMail(),
    ]);
    const ok = database === 'up' && queue === 'up' && mail === 'up';
    res.status(database === 'up' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { status: ok ? 'ok' : 'degraded', checks: { database, queue, mail } };
  }

  private mailUpUntil = 0;

  private async probeMail(): Promise<'up' | 'down'> {
    if (Date.now() < this.mailUpUntil) return 'up';
    const result = await probe(() => this.mail.verify(), MAIL_TIMEOUT_MS);
    this.mailUpUntil = result === 'up' ? Date.now() + MAIL_UP_CACHE_MS : 0;
    return result;
  }
}
