import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import { PrismaService } from '@/database/prisma.service';
import {
  RegisterSearchProvider,
  SEARCH_HITS_PER_PROVIDER,
  type SearchHit,
  type SearchProvider,
} from '@/modules/core/contracts/search.contract';

const TYPE_LABELS = { changelog: 'Changelog', update: 'Update', information: 'Information' } as const;

/** ⌘K search: published news by title (API.md §3.5). */
@Injectable()
@RegisterSearchProvider()
export class NewsSearchProvider implements SearchProvider {
  readonly module = 'news' as const;

  constructor(private readonly prisma: PrismaService) {}

  async search(_user: AuthUser, q: string): Promise<SearchHit[]> {
    const rows = await this.prisma.newsPost.findMany({
      where: { status: 'published', deletedAt: null, title: { contains: q, mode: 'insensitive' } },
      orderBy: { publishedAt: 'desc' },
      take: SEARCH_HITS_PER_PROVIDER,
    });
    return rows.map((row) => ({
      module: 'news',
      type: 'news_post',
      id: row.id,
      reference: null,
      title: row.title,
      subtitle: `${TYPE_LABELS[row.type]} · ${row.summary.slice(0, 80)}`,
      link: `/news/${row.id}`,
    }));
  }
}
