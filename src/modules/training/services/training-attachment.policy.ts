import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import { PrismaService } from '@/database/prisma.service';
import { type AttachmentPolicy, RegisterAttachmentPolicy } from '@/modules/core/contracts/attachment-policy.contract';
import { TrainingAccess } from './training-access.service';

/**
 * Who sees training files: request documents (`training_request`) follow request visibility,
 * booking documents (`training_attendee`) follow participation visibility (SPEC §3.1).
 */
@Injectable()
@RegisterAttachmentPolicy()
export class TrainingAttachmentPolicy implements AttachmentPolicy {
  readonly entityTypes = ['training_request', 'training_attendee'] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TrainingAccess,
  ) {}

  async canView(user: AuthUser, entityType: string, entityId: string): Promise<boolean> {
    const viewer = await this.access.viewer(user);
    if (entityType === 'training_request') {
      return (await this.prisma.trainingRequest.count({ where: { id: entityId, ...viewer.requestWhere() } })) > 0;
    }
    return (await this.prisma.trainingAttendee.count({ where: { id: entityId, ...viewer.attendeeWhere() } })) > 0;
  }
}
