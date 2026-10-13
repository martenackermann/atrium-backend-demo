import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import { PrismaService } from '@/database/prisma.service';
import { type AttachmentPolicy, RegisterAttachmentPolicy } from '@/modules/core/contracts/attachment-policy.contract';
import { newsVisibleWhere } from '../machines/news-post.workflow';

/** Cover images follow the post's visibility. */
@Injectable()
@RegisterAttachmentPolicy()
export class NewsAttachmentPolicy implements AttachmentPolicy {
  readonly entityTypes = ['news_post'] as const;

  constructor(private readonly prisma: PrismaService) {}

  async canView(user: AuthUser, _entityType: string, entityId: string): Promise<boolean> {
    return (await this.prisma.newsPost.count({ where: { id: entityId, ...newsVisibleWhere(user) } })) > 0;
  }
}
