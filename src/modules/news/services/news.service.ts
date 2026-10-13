import { Injectable, Logger } from '@nestjs/common';
import { getNextTransitions } from 'xstate';
import type { AuthUser } from '@/common/auth/auth-user';
import { hasRole } from '@/common/auth/auth-user';
import type { AppAbility } from '@/common/authz/ability.types';
import { toUserRef } from '@/common/domain/mappers';
import { type Paginated, paginate } from '@/common/http/pagination';
import { ProblemException } from '@/common/http/problem';
import { toPrismaOrderBy } from '@/common/http/sort';
import { Clock } from '@/common/time/clock.service';
import { PrismaService } from '@/database/prisma.service';
import type { PrismaTx } from '@/database/prisma.types';
import type { Prisma } from '@/generated/prisma/client';
import { AttachmentService } from '@/modules/core/attachments/attachment.service';
import { AuditService } from '@/modules/core/audit/audit.service';
import { lockRow, WorkflowService } from '@/modules/core/workflow';
import { isNewsEditor } from '../abilities/news.abilities';
import type {
  CreateNewsPostInput,
  ListNewsQueryInput,
  NewsPostDetailView,
  NewsPostSummaryView,
  UpdateNewsPostInput,
} from '../dto/news.dto';
import { newsPostMachine } from '../machines/news-post.machine';
import {
  newsHasContent,
  newsPostInclude,
  type NewsPostRow,
  NewsPostWorkflow,
  newsVisibleWhere,
} from '../machines/news-post.workflow';
import type { NewsAction } from '../news.enums';
import { hasText, sanitizeNewsHtml } from './html-sanitizer';

/** Signed cover URLs live 60 minutes (API.md §2.1 SignedImage). */
const COVER_URL_TTL_SECONDS = 3600;
const EDITABLE: readonly string[] = ['draft', 'scheduled', 'published'];
const DELETABLE: readonly string[] = ['draft', 'archived'];

function editorActingAs(user: AuthUser) {
  return hasRole(user, 'news_editor') ? ('back_office' as const) : ('admin' as const);
}

/** Values compared in `update` audit diffs (the body is summarised, not copied). */
function auditView(row: NewsPostRow) {
  return {
    title: row.title,
    type: row.type,
    summary: row.summary,
    body: `${row.bodyHtml.length} characters`,
    coverImage: row.coverImageId ? 'set' : null,
    pinned: row.pinned,
    expireAt: row.expireAt?.toISOString() ?? null,
  };
}

/** News posts (SPEC §4.6, §5.5; API.md §7.2). */
@Injectable()
export class NewsService {
  private readonly logger = new Logger(NewsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflows: WorkflowService,
    private readonly workflow: NewsPostWorkflow,
    private readonly attachments: AttachmentService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  // --- Reads -----------------------------------------------------------------------

  async list(user: AuthUser, ability: AppAbility, query: ListNewsQueryInput): Promise<Paginated<NewsPostSummaryView>> {
    const editor = isNewsEditor(user);
    const and: Prisma.NewsPostWhereInput[] = [newsVisibleWhere(user)];
    if (editor && query.status.length) and.push({ status: { in: query.status } });
    if (query.type.length) and.push({ type: { in: query.type } });
    if (query.q) {
      and.push({
        OR: [
          { title: { contains: query.q, mode: 'insensitive' } },
          { summary: { contains: query.q, mode: 'insensitive' } },
        ],
      });
    }
    const where: Prisma.NewsPostWhereInput = { AND: and };
    const orderBy: Prisma.NewsPostOrderByWithRelationInput[] = query.sort.length
      ? [...(toPrismaOrderBy(query.sort) as Prisma.NewsPostOrderByWithRelationInput[]), { id: 'desc' }]
      : editor
        ? [{ updatedAt: 'desc' }, { id: 'desc' }]
        : [{ pinned: 'desc' }, { publishedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }];
    const page = await paginate(
      query,
      (p) => this.prisma.newsPost.findMany({ where, orderBy, include: newsPostInclude, ...p }),
      () => this.prisma.newsPost.count({ where }),
    );
    return { data: await Promise.all(page.data.map((row) => this.toSummary(row, user, ability))), meta: page.meta };
  }

  /** The `n` latest published posts, pinned first (Home "My day"). */
  async latest(user: AuthUser, ability: AppAbility, n: number): Promise<NewsPostSummaryView[]> {
    const rows = await this.prisma.newsPost.findMany({
      where: { status: 'published', deletedAt: null },
      orderBy: [{ pinned: 'desc' }, { publishedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      include: newsPostInclude,
      take: n,
    });
    return Promise.all(rows.map((row) => this.toSummary(row, user, ability)));
  }

  async findVisible(user: AuthUser, id: string, db: PrismaTx = this.prisma): Promise<NewsPostRow> {
    const row = await db.newsPost.findFirst({ where: { id, ...newsVisibleWhere(user) }, include: newsPostInclude });
    if (!row) throw ProblemException.notFound('News post');
    return row;
  }

  async detail(id: string, user: AuthUser, ability: AppAbility): Promise<NewsPostDetailView> {
    return this.toDetail(await this.findVisible(user, id), user, ability);
  }

  async timeline(id: string, user: AuthUser) {
    await this.findVisible(user, id);
    // News timelines are for editors and it_admin only (SPEC_RESOLUTIONS #24).
    if (!isNewsEditor(user)) throw ProblemException.forbidden('Only news editors can see the history of a post.');
    return this.audit.timeline([{ entityType: 'news_post', entityId: id }]);
  }

  async availableActions(row: NewsPostRow, user: AuthUser, ability: AppAbility): Promise<NewsAction[]> {
    const actions = (await this.workflows.availableActions(
      this.workflow.definition,
      row,
      user,
      ability,
    )) as NewsAction[];
    if (ability.can('edit', 'NewsPost') && EDITABLE.includes(row.status)) actions.push('edit');
    if (ability.can('delete', 'NewsPost') && DELETABLE.includes(row.status)) actions.push('delete');
    return actions;
  }

  async toSummary(row: NewsPostRow, user: AuthUser, ability: AppAbility): Promise<NewsPostSummaryView> {
    return {
      id: row.id,
      title: row.title,
      type: row.type,
      status: row.status,
      summary: row.summary,
      coverImage: row.coverImageId
        ? {
            attachmentId: row.coverImageId,
            ...this.attachments.downloadUrl(user, row.coverImageId, 'inline', COVER_URL_TTL_SECONDS),
          }
        : null,
      pinned: row.pinned,
      publishAt: row.publishAt?.toISOString() ?? null,
      expireAt: row.expireAt?.toISOString() ?? null,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      author: toUserRef(row.author),
      updatedAt: row.updatedAt.toISOString(),
      availableActions: await this.availableActions(row, user, ability),
    };
  }

  async toDetail(row: NewsPostRow, user: AuthUser, ability: AppAbility): Promise<NewsPostDetailView> {
    return {
      ...(await this.toSummary(row, user, ability)),
      bodyHtml: row.bodyHtml,
      createdAt: row.createdAt.toISOString(),
      version: row.version,
    };
  }

  // --- Writes ----------------------------------------------------------------------

  async create(user: AuthUser, input: CreateNewsPostInput): Promise<NewsPostRow> {
    const now = this.clock.now();
    if (input.expireAt && new Date(input.expireAt) <= now) {
      throw ProblemException.validation({ expireAt: ['Pick an expiry in the future.'] });
    }
    return this.prisma.$transaction(async (tx) => {
      if (input.coverImageId) await this.assertCover(tx, user, input.coverImageId, null);
      const row = await tx.newsPost.create({
        data: {
          title: input.title,
          type: input.type,
          status: 'draft',
          summary: input.summary,
          bodyHtml: sanitizeNewsHtml(input.bodyHtml),
          coverImageId: input.coverImageId ?? null,
          pinned: input.pinned ?? false,
          expireAt: input.expireAt ? new Date(input.expireAt) : null,
          authorId: user.id,
          updatedById: user.id,
        },
        include: newsPostInclude,
      });
      if (input.coverImageId) await this.linkCover(tx, user, row.id, input.coverImageId);
      await this.audit.record(
        {
          module: 'news',
          entityType: 'news_post',
          entityId: row.id,
          action: 'create',
          actorId: user.id,
          actingAs: editorActingAs(user),
          toState: 'draft',
          entityLabel: row.title,
        },
        tx,
      );
      return row;
    });
  }

  async update(user: AuthUser, id: string, input: UpdateNewsPostInput): Promise<NewsPostRow> {
    return this.prisma.$transaction(async (tx) => {
      await lockRow(tx, 'news_posts', id);
      const row = await this.findVisible(user, id, tx);
      if (!isNewsEditor(user)) throw ProblemException.forbidden('Only news editors can edit posts.');
      if (!EDITABLE.includes(row.status)) throw ProblemException.invalidTransition('edit', row.status);
      if (input.version !== undefined && input.version !== row.version) throw ProblemException.versionConflict();

      const now = this.clock.now();
      const data: Prisma.NewsPostUncheckedUpdateManyInput = { updatedById: user.id, version: { increment: 1 } };
      if (input.title !== undefined) data.title = input.title;
      if (input.type !== undefined) data.type = input.type;
      if (input.summary !== undefined) data.summary = input.summary;
      if (input.bodyHtml !== undefined) data.bodyHtml = sanitizeNewsHtml(input.bodyHtml);
      if (input.pinned !== undefined) data.pinned = input.pinned;

      const errors: Record<string, string[]> = {};
      if (input.expireAt !== undefined) {
        const expireAt = input.expireAt ? new Date(input.expireAt) : null;
        if (expireAt && expireAt <= now) errors.expireAt = ['Pick an expiry in the future.'];
        else if (expireAt && row.publishAt && expireAt <= row.publishAt) {
          errors.expireAt = ['The expiry must be after the publication time.'];
        }
        data.expireAt = expireAt;
      }
      // Scheduled and published posts must keep their content (SPEC §5.5 publish guard).
      if (row.status !== 'draft') {
        const summary = (data.summary as string | undefined) ?? row.summary;
        const body = (data.bodyHtml as string | undefined) ?? row.bodyHtml;
        if (!summary.trim()) errors.summary = ['A published or scheduled post needs a summary.'];
        if (!hasText(body)) errors.bodyHtml = ['A published or scheduled post needs a body.'];
      }
      if (Object.keys(errors).length) throw ProblemException.validation(errors);

      if (input.coverImageId !== undefined && input.coverImageId !== row.coverImageId) {
        if (input.coverImageId) await this.assertCover(tx, user, input.coverImageId, row.id);
        data.coverImageId = input.coverImageId;
      }

      const result = await tx.newsPost.updateMany({ where: { id, version: row.version }, data });
      if (result.count === 0) throw ProblemException.versionConflict();
      if (data.coverImageId !== undefined) {
        if (input.coverImageId) await this.linkCover(tx, user, id, input.coverImageId);
        if (row.coverImageId) await this.attachments.softDelete(tx, row.coverImageId);
      }
      const updated = await tx.newsPost.findUniqueOrThrow({ where: { id }, include: newsPostInclude });
      const changes = this.audit.diff('news_post', auditView(row), auditView(updated));
      await this.audit.record(
        {
          module: 'news',
          entityType: 'news_post',
          entityId: id,
          action: 'update',
          actorId: user.id,
          actingAs: editorActingAs(user),
          changes: changes.length ? changes : null,
          entityLabel: updated.title,
        },
        tx,
      );
      return updated;
    });
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, 'news_posts', id);
      const row = await this.findVisible(user, id, tx);
      if (!isNewsEditor(user)) throw ProblemException.forbidden('Only news editors can delete posts.');
      if (!DELETABLE.includes(row.status)) throw ProblemException.invalidTransition('delete', row.status);
      await tx.newsPost.update({ where: { id }, data: { deletedAt: this.clock.now(), version: { increment: 1 } } });
      await this.audit.record(
        {
          module: 'news',
          entityType: 'news_post',
          entityId: id,
          action: 'delete',
          actorId: user.id,
          actingAs: editorActingAs(user),
          fromState: row.status,
          entityLabel: row.title,
        },
        tx,
      );
    });
  }

  /** Runs an HTTP action; publish/schedule without content answer 422 with the missing fields. */
  async act(id: string, action: string, body: unknown, user: AuthUser, ability: AppAbility): Promise<void> {
    if (action === 'publish' || action === 'schedule') {
      const row = await this.findVisible(user, id);
      if (isNewsEditor(user) && ['draft', 'scheduled'].includes(row.status) && !newsHasContent(row)) {
        const errors: Record<string, string[]> = {};
        if (!row.summary.trim()) errors.summary = ['Add a summary before publishing.'];
        if (!hasText(row.bodyHtml)) errors.bodyHtml = ['Write the article before publishing.'];
        throw ProblemException.validation(errors);
      }
    }
    await this.workflows.apply(this.workflow.definition, { id, action, actor: user, ability, input: body });
  }

  // --- Scheduled job -------------------------------------------------------------------

  /** SPEC §8 `news.publish-and-expire`: auto_publish due scheduled posts, auto_expire published ones. */
  async publishAndExpire(now: Date): Promise<{ published: number; expired: number }> {
    const due = await this.prisma.newsPost.findMany({
      where: { status: 'scheduled', publishAt: { lte: now }, deletedAt: null },
      select: { id: true },
    });
    let published = 0;
    for (const { id } of due) {
      if (await this.systemTransition(id, 'auto_publish', now)) published++;
    }
    const expiring = await this.prisma.newsPost.findMany({
      where: { status: 'published', expireAt: { lte: now }, deletedAt: null },
      select: { id: true },
    });
    let expired = 0;
    for (const { id } of expiring) {
      if (await this.systemTransition(id, 'auto_expire', now)) expired++;
    }
    return { published, expired };
  }

  private async systemTransition(id: string, event: 'auto_publish' | 'auto_expire', now: Date): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await lockRow(tx, 'news_posts', id);
      const row = await tx.newsPost.findUnique({ where: { id } });
      if (!row || row.deletedAt) return false;
      const snapshot = newsPostMachine.resolveState({ value: row.status, context: { hasContent: true } });
      const canFire = getNextTransitions(snapshot).some((t) => t.eventType === event);
      if (!canFire) return false;
      if (event === 'auto_publish' && !(row.publishAt && row.publishAt <= now)) return false;
      if (event === 'auto_expire' && !(row.expireAt && row.expireAt <= now)) return false;
      const data: Prisma.NewsPostUncheckedUpdateManyInput =
        event === 'auto_publish'
          ? { status: 'published', publishedAt: row.publishAt, publishAt: null, version: { increment: 1 } }
          : { status: 'archived', archivedAt: now, version: { increment: 1 } };
      const result = await tx.newsPost.updateMany({ where: { id, version: row.version }, data });
      if (result.count === 0) return false;
      await this.audit.record(
        {
          module: 'news',
          entityType: 'news_post',
          entityId: id,
          action: event,
          actorId: null,
          actingAs: 'system',
          fromState: row.status,
          toState: event === 'auto_publish' ? 'published' : 'archived',
          entityLabel: row.title,
          occurredAt: now,
        },
        tx,
      );
      this.logger.log(`${event}: ${row.title}`);
      return true;
    });
  }

  // --- Cover image ---------------------------------------------------------------------

  private async assertCover(tx: PrismaTx, user: AuthUser, attachmentId: string, postId: string | null): Promise<void> {
    const attachment = await tx.attachment.findUnique({ where: { id: attachmentId } });
    const linkedHere = attachment?.entityType === 'news_post' && attachment.entityId === postId;
    const problem =
      !attachment || attachment.deletedAt
        ? 'Upload the cover image again.'
        : attachment.purpose !== 'news_cover'
          ? 'Upload the image as a news cover.'
          : !linkedHere && attachment.entityId
            ? 'This image is already used elsewhere.'
            : !linkedHere && attachment.uploadedById !== user.id
              ? 'Use an image you uploaded.'
              : null;
    if (problem) throw ProblemException.validation({ coverImageId: [problem] });
  }

  private async linkCover(tx: PrismaTx, user: AuthUser, postId: string, attachmentId: string): Promise<void> {
    await this.attachments.link(tx, {
      ids: [attachmentId],
      entityType: 'news_post',
      entityId: postId,
      purposes: ['news_cover'],
      actor: user,
      field: 'coverImageId',
    });
  }
}
