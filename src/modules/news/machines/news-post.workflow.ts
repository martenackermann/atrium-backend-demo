import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import { ProblemException } from '@/common/http/problem';
import { Clock } from '@/common/time/clock.service';
import type { PrismaTx } from '@/database/prisma.types';
import type { Prisma } from '@/generated/prisma/client';
import { defineWorkflow, lockRow, type TransitionChange } from '@/modules/core/workflow';
import { isNewsEditor } from '../abilities/news.abilities';
import { emptyBody, scheduleBody } from '../dto/news.dto';
import { hasText } from '../services/html-sanitizer';
import { newsPostMachine } from './news-post.machine';

export const newsPostInclude = { author: true } satisfies Prisma.NewsPostInclude;
export type NewsPostRow = Prisma.NewsPostGetPayload<{ include: typeof newsPostInclude }>;

/** Minimum lead time of a scheduled publication (SPEC §5.5). */
export const SCHEDULE_LEAD_MS = 5 * 60_000;

export function newsHasContent(row: { title: string; summary: string; bodyHtml: string }): boolean {
  return row.title.trim().length > 0 && row.summary.trim().length > 0 && hasText(row.bodyHtml);
}

/** Visibility: editors see every non-deleted post, everyone else published posts only. */
export function newsVisibleWhere(user: AuthUser): Prisma.NewsPostWhereInput {
  return isNewsEditor(user) ? { deletedAt: null } : { deletedAt: null, status: 'published' };
}

/** The `news_post` workflow (SPEC §5.5) bound to `news_posts`. */
@Injectable()
export class NewsPostWorkflow {
  readonly definition;

  constructor(private readonly clock: Clock) {
    this.definition = defineWorkflow({
      name: 'news_post',
      module: 'news',
      entityType: 'news_post',
      subjectType: 'NewsPost',
      machine: newsPostMachine,
      actions: {
        publish: { input: emptyBody },
        schedule: { input: scheduleBody },
        unschedule: { input: emptyBody },
        archive: { input: emptyBody },
        restore: { input: emptyBody },
      },
      entityId: (row: NewsPostRow) => row.id,
      entityLabel: (row: NewsPostRow) => row.title,
      toState: (row: NewsPostRow) => ({ value: row.status, context: { hasContent: newsHasContent(row) } }),
      load: async (tx: PrismaTx, id: string, actor: AuthUser) => {
        if (!(await lockRow(tx, 'news_posts', id))) return null;
        return tx.newsPost.findFirst({ where: { id, ...newsVisibleWhere(actor) }, include: newsPostInclude });
      },
      persist: (tx: PrismaTx, row: NewsPostRow, next: { value: string }, change: TransitionChange) =>
        this.persist(tx, row, next.value, change),
    });
  }

  private async persist(
    tx: PrismaTx,
    row: NewsPostRow,
    status: string,
    change: TransitionChange,
  ): Promise<NewsPostRow | null> {
    const now = this.clock.now();
    const data: Prisma.NewsPostUncheckedUpdateManyInput = {
      status: status as NewsPostRow['status'],
      updatedById: change.actor.id,
      version: { increment: 1 },
    };
    switch (change.action) {
      case 'publish':
        if (row.expireAt && row.expireAt <= now) {
          throw ProblemException.validation({ expireAt: ['The expiry date has passed. Change or clear it first.'] });
        }
        data.publishedAt = now;
        data.publishAt = null;
        break;
      case 'schedule': {
        const input = change.input as { publishAt: string; expireAt?: string | null };
        const publishAt = new Date(input.publishAt);
        const expireAt = input.expireAt === undefined ? row.expireAt : input.expireAt ? new Date(input.expireAt) : null;
        const errors: Record<string, string[]> = {};
        if (publishAt.getTime() < now.getTime() + SCHEDULE_LEAD_MS) {
          errors.publishAt = ['Pick a time at least 5 minutes from now.'];
        }
        if (expireAt && expireAt <= publishAt) errors.expireAt = ['The expiry must be after the publication time.'];
        if (Object.keys(errors).length) throw ProblemException.validation(errors);
        data.publishAt = publishAt;
        data.expireAt = expireAt;
        break;
      }
      case 'unschedule':
        data.publishAt = null;
        break;
      case 'archive':
        data.archivedAt = now;
        break;
      case 'restore':
        data.publishAt = null;
        data.expireAt = null;
        data.publishedAt = null;
        data.archivedAt = null;
        break;
    }
    const result = await tx.newsPost.updateMany({ where: { id: row.id, version: row.version }, data });
    if (result.count === 0) return null;
    return tx.newsPost.findUniqueOrThrow({ where: { id: row.id }, include: newsPostInclude });
  }
}
