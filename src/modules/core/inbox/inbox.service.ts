import { Injectable, Logger } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import { INBOX_MODULES, type InboxModule } from '@/common/domain/vocabulary';
import type { InboxItem } from '../contracts/inbox.contract';
import type { MyDayFragments } from '../contracts/my-day.contract';
import { ProviderRegistry } from '../contracts/provider.registry';
import { type SearchHit, SEARCH_HITS_PER_PROVIDER } from '../contracts/search.contract';

export const INBOX_MAX_ITEMS = 200;

export interface InboxSummary {
  data: InboxItem[];
  meta: { total: number; high: number; byModule: Record<InboxModule, number> };
}

/** Inbox order (API.md §3.2): high priority first, then dueAt ascending (nulls last), then createdAt. */
export function compareInboxItems(a: InboxItem, b: InboxItem): number {
  if (a.priority !== b.priority) return a.priority === 'high' ? -1 : 1;
  if (a.dueAt !== b.dueAt) {
    if (a.dueAt === null) return 1;
    if (b.dueAt === null) return -1;
    return a.dueAt < b.dueAt ? -1 : 1;
  }
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

/**
 * Aggregates the provider framework: inbox items, search hits and my-day fragments from
 * every registered module provider. A failing provider is logged and skipped.
 */
@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);

  constructor(private readonly registry: ProviderRegistry) {}

  async inbox(user: AuthUser, filter: { modules?: InboxModule[]; types?: string[] } = {}): Promise<InboxSummary> {
    const providers = this.registry.inbox.filter((p) => !filter.modules?.length || filter.modules.includes(p.module));
    const lists = await Promise.all(providers.map((p) => this.safe(`inbox ${p.module}`, () => p.items(user), [])));
    const items = lists
      .flat()
      .filter((item) => !filter.types?.length || filter.types.includes(item.type))
      .sort(compareInboxItems)
      .slice(0, INBOX_MAX_ITEMS);
    const byModule = Object.fromEntries(INBOX_MODULES.map((m) => [m, 0])) as Record<InboxModule, number>;
    for (const item of items) byModule[item.module]++;
    return {
      data: items,
      meta: { total: items.length, high: items.filter((i) => i.priority === 'high').length, byModule },
    };
  }

  async search(user: AuthUser, q: string): Promise<SearchHit[]> {
    const lists = await Promise.all(
      this.registry.search.map((p) =>
        this.safe(`search ${p.module}`, async () => (await p.search(user, q)).slice(0, SEARCH_HITS_PER_PROVIDER), []),
      ),
    );
    return lists.flat();
  }

  /** Merged my-day fragments (for A4's `GET /home/my-day`). */
  async myDay(user: AuthUser): Promise<MyDayFragments> {
    const parts = await Promise.all(this.registry.myDay.map((c) => this.safe('my-day', () => c.contribute(user), {})));
    const merged: MyDayFragments = { upcoming: [], assets: null, news: [], links: [] };
    for (const part of parts) {
      merged.upcoming.push(...(part.upcoming ?? []));
      if (part.assets !== undefined) merged.assets = part.assets;
      merged.news.push(...(part.news ?? []));
      merged.links.push(...(part.links ?? []));
    }
    return merged;
  }

  private async safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      this.logger.error(error, `Provider failed: ${label}`);
      return fallback;
    }
  }
}
