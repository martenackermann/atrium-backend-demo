import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import { isoFromDate } from '@/common/time/time';
import { PrismaService } from '@/database/prisma.service';
import type { Prisma } from '@/generated/prisma/client';
import {
  RegisterSearchProvider,
  SEARCH_HITS_PER_PROVIDER,
  type SearchHit,
  type SearchProvider,
} from '@/modules/core/contracts/search.contract';
import { formatDateRange, parseTrainingReference, trainingReference } from '../training.constants';
import { TrainingAccess } from './training-access.service';

/**
 * ⌘K search (API.md §3.5): requests by exact reference, topic or provider (visible ones only),
 * plus participations by attendee name for the viewer's approvals (approver / deputy).
 */
@Injectable()
@RegisterSearchProvider()
export class TrainingSearchProvider implements SearchProvider {
  readonly module = 'training' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TrainingAccess,
  ) {}

  async search(user: AuthUser, q: string): Promise<SearchHit[]> {
    const viewer = await this.access.viewer(user);
    const num = parseTrainingReference(q);
    const text: Prisma.TrainingRequestWhereInput =
      num !== null
        ? { number: num }
        : {
            OR: [
              { topic: { contains: q, mode: 'insensitive' } },
              { provider: { contains: q, mode: 'insensitive' } },
            ],
          };
    const requests = await this.prisma.trainingRequest.findMany({
      where: { AND: [text, viewer.requestWhere()] },
      orderBy: { startsOn: 'desc' },
      take: SEARCH_HITS_PER_PROVIDER,
    });
    const hits: SearchHit[] = requests.map((r) => ({
      module: 'training',
      type: 'training_request',
      id: r.id,
      reference: trainingReference(r.number),
      title: r.topic,
      subtitle: `${r.provider} · ${formatDateRange(isoFromDate(r.startsOn), isoFromDate(r.endsOn), viewer.today)}`,
      link: `/training/requests/${r.id}`,
    }));

    if (hits.length < SEARCH_HITS_PER_PROVIDER && num === null) {
      const approvers = [user.id, ...viewer.principals];
      const participations = await this.prisma.trainingAttendee.findMany({
        where: {
          user: { displayName: { contains: q, mode: 'insensitive' } },
          userId: { not: user.id },
          OR: [{ approverId: { in: approvers } }, { executiveApproverId: { in: approvers } }],
        },
        include: { user: true, request: true },
        orderBy: { createdAt: 'desc' },
        take: SEARCH_HITS_PER_PROVIDER - hits.length,
      });
      for (const p of participations) {
        hits.push({
          module: 'training',
          type: 'training_participation',
          id: p.id,
          reference: trainingReference(p.request.number),
          title: `${p.user.displayName}: ${p.request.topic}`,
          subtitle: p.request.provider,
          link: `/training/participations/${p.id}`,
        });
      }
    }
    return hits.slice(0, SEARCH_HITS_PER_PROVIDER);
  }
}
