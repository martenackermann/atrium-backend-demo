import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import type { AuthUser } from '@/common/auth/auth-user';
import { CurrentUser } from '@/common/auth/current-user.decorator';
import { isoDateTimeSchema, moduleNameSchema, notificationPrioritySchema } from '@/common/domain/schemas';
import { ApiProblemResponses } from '@/common/http/api-problem-response.decorator';
import { pageMeta, pageMetaSchema, paginationQuerySchema, toSkipTake } from '@/common/http/pagination';
import { ProblemException } from '@/common/http/problem';
import { UuidPipe } from '@/common/http/uuid.pipe';
import { Clock } from '@/common/time/clock.service';
import { PrismaService } from '@/database/prisma.service';
import type { ModuleName } from '@/common/domain/vocabulary';

const notificationSchema = z.object({
  id: z.uuid(),
  templateId: z.string(),
  module: moduleNameSchema,
  title: z.string(),
  body: z.string(),
  link: z.string().nullable(),
  priority: notificationPrioritySchema,
  readAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
class NotificationPageDto extends createZodDto(
  z.object({ data: z.array(notificationSchema), meta: pageMetaSchema.extend({ unread: z.number().int() }) }),
) {}
class ListNotificationsQuery extends createZodDto(
  paginationQuerySchema.extend({
    unread: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
  }),
) {}

@ApiTags('me')
@Controller('me/notifications')
export class NotificationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  @Get()
  @ZodResponse({ type: NotificationPageDto })
  async list(@CurrentUser() user: AuthUser, @Query() query: ListNotificationsQuery): Promise<NotificationPageDto> {
    const where = { userId: user.id, ...(query.unread ? { readAt: null } : {}) };
    const [rows, total, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...toSkipTake(query),
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);
    return {
      data: rows.map((n) => ({
        id: n.id,
        templateId: n.templateId,
        module: n.module as ModuleName,
        title: n.title,
        body: n.body,
        link: n.link,
        priority: n.priority,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
      meta: { ...pageMeta(total, query), unread },
    };
  }

  @Post('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'All notifications marked as read' })
  async readAll(@CurrentUser() user: AuthUser): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: this.clock.now() },
    });
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Marked as read' })
  @ApiProblemResponses(404)
  async read(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string): Promise<void> {
    const row = await this.prisma.notification.findUnique({ where: { id } });
    if (!row || row.userId !== user.id) throw ProblemException.notFound('Notification');
    if (!row.readAt) await this.prisma.notification.update({ where: { id }, data: { readAt: this.clock.now() } });
  }
}
