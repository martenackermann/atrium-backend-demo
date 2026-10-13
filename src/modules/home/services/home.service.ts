import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import { Clock } from '@/common/time/clock.service';
import { addDaysIso, startOfDayInZone } from '@/common/time/time';
import { InboxService } from '@/modules/core/inbox/inbox.service';
import type { UsefulLinkView } from '@/modules/news/dto/links.dto';
import type { NewsPostSummaryView } from '@/modules/news/dto/news.dto';
import type { MyDayView } from '../dto/my-day.dto';

export const MY_DAY_INBOX_TOP = 5;
export const MY_DAY_UPCOMING_DAYS = 30;
export const MY_DAY_UPCOMING_MAX = 8;

/**
 * `GET /home/my-day` (API.md §7.4): the inbox head from the core inbox, plus the fragments
 * every module contributes through `MyDayContributor` (A1/A2 upcoming, A3 assets, A4 news + links).
 */
@Injectable()
export class HomeService {
  constructor(
    private readonly inbox: InboxService,
    private readonly clock: Clock,
  ) {}

  async myDay(user: AuthUser): Promise<MyDayView> {
    const today = this.clock.today();
    const [inbox, fragments] = await Promise.all([this.inbox.inbox(user), this.inbox.myDay(user)]);
    const from = startOfDayInZone(today, this.clock.timeZone).toISOString();
    const until = startOfDayInZone(addDaysIso(today, MY_DAY_UPCOMING_DAYS + 1), this.clock.timeZone).toISOString();
    const upcoming = fragments.upcoming
      .filter((item) => item.startsAt < until && (item.endsAt ?? item.startsAt) >= from)
      .sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0))
      .slice(0, MY_DAY_UPCOMING_MAX);
    return {
      date: today,
      inbox: { total: inbox.meta.total, high: inbox.meta.high, top: inbox.data.slice(0, MY_DAY_INBOX_TOP) },
      upcoming,
      assets: fragments.assets,
      news: fragments.news as NewsPostSummaryView[],
      links: fragments.links as UsefulLinkView[],
    };
  }
}
