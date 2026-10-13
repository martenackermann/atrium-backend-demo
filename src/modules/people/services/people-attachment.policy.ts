import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import { PrismaService } from '@/database/prisma.service';
import { type AttachmentPolicy, RegisterAttachmentPolicy } from '@/modules/core/contracts/attachment-policy.contract';
import { canSeePersonalData } from './people-access';

/** People documents are visible only to those who may see personal data (SPEC_RESOLUTIONS #25). */
@Injectable()
@RegisterAttachmentPolicy()
export class PeopleAttachmentPolicy implements AttachmentPolicy {
  readonly entityTypes = ['people_request'] as const;

  constructor(private readonly prisma: PrismaService) {}

  async canView(user: AuthUser, _entityType: string, entityId: string): Promise<boolean> {
    const row = await this.prisma.peopleRequest.findUnique({
      where: { id: entityId },
      select: { requesterId: true, managerId: true, managerDeputyId: true },
    });
    return !!row && canSeePersonalData(user, row);
  }
}
