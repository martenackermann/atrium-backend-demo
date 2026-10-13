import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import { AbilityFactory } from '@/common/authz/ability.factory';
import {
  type MyDayContributor,
  type MyDayFragments,
  RegisterMyDayContributor,
} from '@/modules/core/contracts/my-day.contract';
import { LinksService } from './links.service';
import { NewsService } from './news.service';

/** Home "My day": the 3 latest published posts (pinned first) and the active links. */
@Injectable()
@RegisterMyDayContributor()
export class NewsMyDayContributor implements MyDayContributor {
  constructor(
    private readonly news: NewsService,
    private readonly links: LinksService,
    private readonly abilities: AbilityFactory,
  ) {}

  async contribute(user: AuthUser): Promise<Partial<MyDayFragments>> {
    const ability = await this.abilities.createForUser(user);
    const [news, links] = await Promise.all([this.news.latest(user, ability, 3), this.links.list(user)]);
    return { news, links };
  }
}
