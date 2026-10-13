import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import { isoFromDate } from '@/common/time/time';
import { PrismaService } from '@/database/prisma.service';
import {
  RegisterSearchProvider,
  SEARCH_HITS_PER_PROVIDER,
  type SearchHit,
  type SearchProvider,
} from '@/modules/core/contracts/search.contract';
import { peopleReference, shortDate, STATUS_LABELS, TYPE_LABELS } from '../people.constants';
import { visibleWhere } from './people-access';
import { PeopleRequestsService } from './people-requests.service';

/** ⌘K search over the people requests the user may see (reference exact, title/names ILIKE). */
@Injectable()
@RegisterSearchProvider()
export class PeopleSearchProvider implements SearchProvider {
  readonly module = 'people' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly requests: PeopleRequestsService,
  ) {}

  async search(user: AuthUser, q: string): Promise<SearchHit[]> {
    const rows = await this.prisma.peopleRequest.findMany({
      where: { AND: [visibleWhere(user), this.requests.textFilter(q)] },
      orderBy: { createdAt: 'desc' },
      take: SEARCH_HITS_PER_PROVIDER,
    });
    return rows.map((row) => ({
      module: 'people',
      type: 'people_request',
      id: row.id,
      reference: peopleReference(row.number),
      title: row.title,
      subtitle: `${TYPE_LABELS[row.type]} · ${row.firstName} ${row.lastName} · ${STATUS_LABELS[row.status]} · ${shortDate(isoFromDate(row.effectiveDate))}`,
      link: `/people-requests/${row.id}`,
    }));
  }
}
