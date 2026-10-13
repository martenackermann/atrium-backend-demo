import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import { PrismaService } from '@/database/prisma.service';
import {
  type MyDayContributor,
  type MyDayFragments,
  RegisterMyDayContributor,
} from '@/modules/core/contracts/my-day.contract';
import { ACTIVE_STATUSES } from '../assets.domain';

/** API.md §7.4 `assets` fragment of "My day". */
@Injectable()
@RegisterMyDayContributor()
export class AssetsMyDayContributor implements MyDayContributor {
  constructor(private readonly prisma: PrismaService) {}

  async contribute(user: AuthUser): Promise<Partial<MyDayFragments>> {
    const [active, pendingAcceptance] = await Promise.all([
      this.prisma.asset.count({
        where: { assignedUserId: user.id, deletedAt: null, status: { in: [...ACTIVE_STATUSES] } },
      }),
      this.prisma.asset.count({ where: { assignedUserId: user.id, deletedAt: null, status: 'pending_acceptance' } }),
    ]);
    return { assets: { active, pendingAcceptance } };
  }
}
