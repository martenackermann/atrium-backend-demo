import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import { Clock } from '@/common/time/clock.service';
import { addDaysIso, dateFromIso, isoFromDate, startOfDayInZone } from '@/common/time/time';
import { PrismaService } from '@/database/prisma.service';
import {
  type MyDayContributor,
  type MyDayFragments,
  RegisterMyDayContributor,
} from '@/modules/core/contracts/my-day.contract';

/** "Coming up" on the home page (API.md §7.4): my pending / to-book / booked trainings, next 30 days. */
@Injectable()
@RegisterMyDayContributor()
export class TrainingMyDayContributor implements MyDayContributor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async contribute(user: AuthUser): Promise<Partial<MyDayFragments>> {
    const today = this.clock.today();
    const tz = this.clock.timeZone;
    const rows = await this.prisma.trainingAttendee.findMany({
      where: {
        userId: user.id,
        status: { in: ['pending_manager_approval', 'pending_executive_approval', 'to_book', 'booked'] },
        request: { startsOn: { gte: dateFromIso(today), lte: dateFromIso(addDaysIso(today, 30)) } },
      },
      include: { request: true },
      orderBy: [{ request: { startsOn: 'asc' } }, { id: 'asc' }],
      take: 8,
    });
    return {
      upcoming: rows.map((r) => ({
        module: 'training',
        entityId: r.id,
        kind: 'training',
        title: r.request.topic,
        subtitle:
          r.status === 'booked' && r.bookingReference
            ? `${r.request.provider} · Booked · ${r.bookingReference}`
            : r.request.provider,
        startsAt: startOfDayInZone(isoFromDate(r.request.startsOn), tz).toISOString(),
        endsAt: startOfDayInZone(isoFromDate(r.request.endsOn), tz).toISOString(),
        status: r.status,
        link: `/training/participations/${r.id}`,
      })),
    };
  }
}
