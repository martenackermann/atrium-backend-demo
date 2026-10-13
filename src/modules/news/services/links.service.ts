import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import { hasRole } from '@/common/auth/auth-user';
import { ProblemException } from '@/common/http/problem';
import { PrismaService } from '@/database/prisma.service';
import { AuditService } from '@/modules/core/audit/audit.service';
import { isNewsEditor } from '../abilities/news.abilities';
import type { UpdateUsefulLinkInput, UsefulLinkInput, UsefulLinkView } from '../dto/links.dto';

type LinkRow = {
  id: string;
  title: string;
  url: string;
  description: string | null;
  icon: string | null;
  category: string | null;
  sortOrder: number;
  active: boolean;
};

export const toLinkView = (row: LinkRow): UsefulLinkView => ({
  id: row.id,
  title: row.title,
  url: row.url,
  description: row.description,
  icon: row.icon,
  category: row.category,
  sortOrder: row.sortOrder,
  active: row.active,
});

/** Useful links (SPEC §4.6; API.md §7.3): everyone reads active links, editors manage them. */
@Injectable()
export class LinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private actingAs(user: AuthUser) {
    return hasRole(user, 'news_editor') ? ('back_office' as const) : ('admin' as const);
  }

  async list(user: AuthUser, includeInactive = false): Promise<UsefulLinkView[]> {
    const rows = await this.prisma.usefulLink.findMany({
      where: includeInactive && isNewsEditor(user) ? {} : { active: true },
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
    });
    return rows.map(toLinkView);
  }

  async create(user: AuthUser, input: UsefulLinkInput): Promise<UsefulLinkView> {
    return this.prisma.$transaction(async (tx) => {
      const last = await tx.usefulLink.aggregate({ _max: { sortOrder: true } });
      const row = await tx.usefulLink.create({
        data: {
          title: input.title,
          url: input.url,
          description: input.description ?? null,
          icon: input.icon ?? null,
          category: input.category ?? null,
          active: input.active ?? true,
          sortOrder: input.sortOrder ?? (last._max.sortOrder ?? -1) + 1,
          createdById: user.id,
        },
      });
      await this.audit.record(
        {
          module: 'news',
          entityType: 'useful_link',
          entityId: row.id,
          action: 'create',
          actorId: user.id,
          actingAs: this.actingAs(user),
          entityLabel: row.title,
        },
        tx,
      );
      return toLinkView(row);
    });
  }

  async update(user: AuthUser, id: string, input: UpdateUsefulLinkInput): Promise<UsefulLinkView> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.usefulLink.findUnique({ where: { id } });
      if (!before) throw ProblemException.notFound('Link');
      const row = await tx.usefulLink.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.url !== undefined ? { url: input.url } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.icon !== undefined ? { icon: input.icon } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        },
      });
      const changes = this.audit.diff('useful_link', before, row);
      await this.audit.record(
        {
          module: 'news',
          entityType: 'useful_link',
          entityId: id,
          action: 'update',
          actorId: user.id,
          actingAs: this.actingAs(user),
          changes: changes.length ? changes : null,
          entityLabel: row.title,
        },
        tx,
      );
      return toLinkView(row);
    });
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.usefulLink.findUnique({ where: { id } });
      if (!row) throw ProblemException.notFound('Link');
      await tx.usefulLink.delete({ where: { id } });
      await this.audit.record(
        {
          module: 'news',
          entityType: 'useful_link',
          entityId: id,
          action: 'delete',
          actorId: user.id,
          actingAs: this.actingAs(user),
          entityLabel: row.title,
          metadata: { url: row.url },
        },
        tx,
      );
    });
  }

  /** `PUT /links/order`: `ids` must list every link exactly once, in the new order. */
  async reorder(user: AuthUser, ids: string[]): Promise<UsefulLinkView[]> {
    return this.prisma.$transaction(async (tx) => {
      const all = await tx.usefulLink.findMany({ select: { id: true } });
      const known = new Set(all.map((l) => l.id));
      const unique = new Set(ids);
      if (unique.size !== ids.length || unique.size !== known.size || ids.some((id) => !known.has(id))) {
        throw ProblemException.validation({ ids: ['List every link exactly once, in the new order.'] });
      }
      for (const [index, id] of ids.entries()) {
        await tx.usefulLink.update({ where: { id }, data: { sortOrder: index } });
      }
      await this.audit.record(
        {
          module: 'news',
          entityType: 'useful_link',
          entityId: ids[0],
          action: 'reorder',
          actorId: user.id,
          actingAs: this.actingAs(user),
          entityLabel: 'Useful links',
          metadata: { order: ids },
        },
        tx,
      );
      const rows = await tx.usefulLink.findMany({ orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }] });
      return rows.map(toLinkView);
    });
  }
}
