import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import { PrismaService } from '@/database/prisma.service';
import {
  RegisterSearchProvider,
  type SearchHit,
  SEARCH_HITS_PER_PROVIDER,
  type SearchProvider,
} from '@/modules/core/contracts/search.contract';
import { isAssetAdmin } from '../abilities/assets.abilities';
import { assetTag, parseAssetTag } from '../assets.domain';
import { ASSET_ENUMS } from '../assets.enums';

const statusLabel = (status: string) => ASSET_ENUMS.assetStatus.find((o) => o.value === status)?.label ?? status;

/** API.md §3.5: asset tag (exact) or serial / device name; admins see all, users their own devices. */
@Injectable()
@RegisterSearchProvider()
export class AssetsSearchProvider implements SearchProvider {
  readonly module = 'assets' as const;

  constructor(private readonly prisma: PrismaService) {}

  async search(user: AuthUser, q: string): Promise<SearchHit[]> {
    const admin = isAssetAdmin(user);
    const tag = parseAssetTag(q);
    const text = { contains: q.trim(), mode: 'insensitive' } as const;
    const rows = await this.prisma.asset.findMany({
      where: {
        deletedAt: null,
        ...(admin ? {} : { assignedUserId: user.id }),
        ...(tag !== null ? { number: tag } : { OR: [{ serialNumber: text }, { name: text }] }),
      },
      include: { model: true, assignedUser: true },
      orderBy: { number: 'asc' },
      take: SEARCH_HITS_PER_PROVIDER,
    });
    return rows.map((r) => ({
      module: 'assets',
      type: 'asset',
      id: r.id,
      reference: assetTag(r.number),
      title: r.model.name,
      subtitle: [
        `Serial ${r.serialNumber}`,
        statusLabel(r.status),
        admin && r.assignedUser ? r.assignedUser.displayName : null,
      ]
        .filter(Boolean)
        .join(' · '),
      link: admin ? `/back-office/assets/inventory/${r.id}` : `/assets/${r.id}`,
    }));
  }
}
