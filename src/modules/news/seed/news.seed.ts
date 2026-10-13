import type { SeedContext, Seeder } from '@/database/seed/seed-context';
import type { Prisma } from '@/generated/prisma/client';
import { sanitizeNewsHtml } from '../services/html-sanitizer';
import { gradientPng } from './cover-image';
import { type At, LINKS_STORY, NEWS_STORY } from './news.story';

async function seedNews(ctx: SeedContext): Promise<void> {
  const { prisma } = ctx;
  const at = ([day, hour, minute]: At) => ctx.at(day, hour, minute);

  for (const story of NEWS_STORY) {
    const author = ctx.users.get(story.author);
    const createdAt = at(story.createdAt);
    const id = ctx.uuid(createdAt);
    const publishedAt = story.publishedAt ? at(story.publishedAt) : null;
    const archivedAt = story.archivedAt ? at(story.archivedAt) : null;
    const transitions: { action: string; from: string; to: string; when: Date }[] = [];
    if (story.status === 'scheduled') {
      transitions.push({
        action: 'schedule',
        from: 'draft',
        to: 'scheduled',
        when: new Date(createdAt.getTime() + 600_000),
      });
    }
    if (publishedAt) transitions.push({ action: 'publish', from: 'draft', to: 'published', when: publishedAt });
    if (archivedAt) transitions.push({ action: 'archive', from: 'published', to: 'archived', when: archivedAt });
    const updatedAt = transitions.at(-1)?.when ?? createdAt;

    await prisma.newsPost.create({
      data: {
        id,
        title: story.title,
        type: story.type,
        status: story.status,
        summary: story.summary,
        bodyHtml: sanitizeNewsHtml(story.bodyHtml),
        pinned: story.pinned ?? false,
        publishAt: story.publishAt ? at(story.publishAt) : null,
        expireAt: story.expireAt ? at(story.expireAt) : null,
        publishedAt,
        archivedAt,
        authorId: author.id,
        updatedById: author.id,
        version: 1 + transitions.length,
        createdAt,
        updatedAt,
      },
    });
    if (story.cover) {
      const file = await ctx.storeFile({
        content: gradientPng(),
        originalName: 'welcome-to-atrium.png',
        mimeType: 'image/png',
        purpose: 'news_cover',
        uploadedById: author.id,
        createdAt,
        entity: { type: 'news_post', id },
      });
      await prisma.newsPost.update({ where: { id }, data: { coverImageId: file.id, updatedAt } });
    }

    const audit = (
      row: Omit<Prisma.AuditLogUncheckedCreateInput, 'id' | 'module' | 'entityType' | 'entityId' | 'correlationId'>,
    ) =>
      prisma.auditLog.create({
        data: {
          id: ctx.uuid(row.occurredAt as Date),
          module: 'news',
          entityType: 'news_post',
          entityId: id,
          correlationId: 'seed',
          metadata: { entityLabel: story.title },
          ...row,
        },
      });
    const actingAs = story.author === 'ian' ? ('admin' as const) : ('back_office' as const);
    await audit({ occurredAt: createdAt, actorId: author.id, actingAs, action: 'create', toState: 'draft' });
    for (const t of transitions) {
      await audit({
        occurredAt: t.when,
        actorId: author.id,
        actingAs,
        action: t.action,
        fromState: t.from,
        toState: t.to,
      });
    }
  }

  const paula = ctx.users.get('paula');
  for (const [index, link] of LINKS_STORY.entries()) {
    const createdAt = ctx.at(-120, 9, index);
    const id = ctx.uuid(createdAt);
    await prisma.usefulLink.create({ data: { id, ...link, sortOrder: index, createdById: paula.id, createdAt } });
    await prisma.auditLog.create({
      data: {
        id: ctx.uuid(createdAt),
        occurredAt: createdAt,
        actorId: paula.id,
        actingAs: 'back_office',
        module: 'news',
        entityType: 'useful_link',
        entityId: id,
        action: 'create',
        metadata: { entityLabel: link.title },
        correlationId: 'seed',
      },
    });
  }
  ctx.log(`news: ${NEWS_STORY.length} posts, ${LINKS_STORY.length} links`);
}

export const seeder: Seeder = { name: 'news posts and useful links', run: seedNews };
