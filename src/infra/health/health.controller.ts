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
      probe(() => this.mail.verify()),
    ]);
    const ok = database === 'up' && queue === 'up' && mail === 'up';
    res.status(database === 'up' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { status: ok ? 'ok' : 'degraded', checks: { database, queue, mail } };
  }
}
