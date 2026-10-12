import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Public } from '@/common/auth/public.decorator';
import { PrismaService } from '@/database/prisma.service';
import { QueueService } from '@/infra/queue/queue.service';

const checkSchema = z.object({ status: z.enum(['up', 'down']), durationMs: z.number() });

export const healthSchema = z.object({
  status: z.enum(['ok', 'error']),
  checks: z.object({ database: checkSchema, queue: checkSchema }),
});

export class HealthDto extends createZodDto(healthSchema) {}

type Check = z.infer<typeof checkSchema>;

async function timed(probe: () => Promise<boolean>): Promise<Check> {
  const started = performance.now();
  const up = await probe().catch(() => false);
  return { status: up ? 'up' : 'down', durationMs: Math.round((performance.now() - started) * 10) / 10 };
}

@ApiTags('system')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Liveness/readiness: database and job queue' })
  @ApiResponse({ status: 200, type: HealthDto, description: 'All dependencies are up' })
  @ApiResponse({ status: 503, type: HealthDto, description: 'At least one dependency is down' })
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthDto> {
    const [database, queue] = await Promise.all([
      timed(async () => {
        await this.prisma.$queryRaw`SELECT 1`;
        return true;
      }),
      timed(() => this.queue.isHealthy()),
    ]);
    const ok = database.status === 'up' && queue.status === 'up';
    res.status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { status: ok ? 'ok' : 'error', checks: { database, queue } };
  }
}
