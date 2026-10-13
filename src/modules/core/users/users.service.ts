import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import { hasRole } from '@/common/auth/auth-user';
import { toRef, toUserRef, toUserRefOrNull, toUserSummary, userSummaryInclude } from '@/common/domain/mappers';
import type { PersonaKey } from '@/common/domain/vocabulary';
import { paginate, type Paginated } from '@/common/http/pagination';
import { ProblemException } from '@/common/http/problem';
import { toPrismaOrderBy } from '@/common/http/sort';
import { Clock } from '@/common/time/clock.service';
import { isoFromDateOrNull, withinWindow } from '@/common/time/time';
import { PrismaService } from '@/database/prisma.service';
import type { Prisma } from '@/generated/prisma/client';
import { ApprovalService } from '../approvals/approval.service';
import { effectiveRoles } from './principal.service';
import type { ListUsersQuery, MeDto, UserProfileDto } from './users.dto';

const profileInclude = {
  ...userSummaryInclude,
  costCenter: true,
  manager: true,
  roles: { select: { role: true } },
  directReports: { where: { active: true }, orderBy: { displayName: 'asc' } },
} satisfies Prisma.UserInclude;

type ProfileRow = Prisma.UserGetPayload<{ include: typeof profileInclude }>;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalService,
    private readonly clock: Clock,
  ) {}

  async me(userId: string): Promise<MeDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: profileInclude });
    if (!user) throw ProblemException.notFound('User');
    const roles = this.rolesOf(user);
    const today = this.clock.today();
    const deputyFor = await this.prisma.deputy.findMany({
      where: { deputyId: userId, principal: { active: true } },
      include: { principal: true },
      orderBy: { createdAt: 'asc' },
    });
    return {
      ...toUserSummary(user),
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      roles,
      isManager: roles.includes('manager'),
      isExecutive: roles.includes('executive'),
      isSiteManager: user.isSiteManager,
      manager: toUserRefOrNull(user.manager),
      costCenter: toRef(user.costCenter),
      activeDeputyFor: deputyFor
        .map((d) => ({
          principal: toUserRef(d.principal),
          validFrom: isoFromDateOrNull(d.validFrom),
          validTo: isoFromDateOrNull(d.validTo),
        }))
        .filter((d) => withinWindow(today, d.validFrom, d.validTo)),
      personaKey: (user.personaKey as PersonaKey | null) ?? null,
    };
  }

  async profile(id: string): Promise<UserProfileDto> {
    const user = await this.prisma.user.findUnique({ where: { id }, include: profileInclude });
    if (!user) throw ProblemException.notFound('User');
    return {
      ...toUserSummary(user),
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      manager: toUserRefOrNull(user.manager),
      directReports: user.directReports.map(toUserRef),
      costCenter: toRef(user.costCenter),
      roles: this.rolesOf(user),
      isSiteManager: user.isSiteManager,
    };
  }

  async list(actor: AuthUser, query: ListUsersQuery): Promise<Paginated<ReturnType<typeof toUserSummary>>> {
    const and: Prisma.UserWhereInput[] = [];
    if (!(query.includeInactive && hasRole(actor, 'it_admin'))) and.push({ active: true });
    if (query.q) {
      and.push({
        OR: [
          { displayName: { contains: query.q, mode: 'insensitive' } },
          { email: { contains: query.q, mode: 'insensitive' } },
        ],
      });
    }
    if (query.departmentId) and.push({ departmentId: query.departmentId });
    if (query.siteId) and.push({ siteId: query.siteId });
    if (query.role === 'manager') and.push({ directReports: { some: { active: true } } });
    else if (query.role && query.role !== 'employee') and.push({ roles: { some: { role: query.role } } });
    if (query.scope === 'team') and.push({ id: { in: await this.approvals.reportingTreeIds(actor.id) } });

    const where: Prisma.UserWhereInput = { AND: and };
    const orderBy = [...toPrismaOrderBy(query.sort), { id: 'asc' }] as Prisma.UserOrderByWithRelationInput[];
    return paginate(
      query,
      async (page) =>
        (await this.prisma.user.findMany({ where, orderBy, include: userSummaryInclude, ...page })).map(toUserSummary),
      () => this.prisma.user.count({ where }),
    );
  }

  /** 404 unless the user exists (used before approver chains). */
  async assertExists(id: string): Promise<void> {
    if (!(await this.prisma.user.count({ where: { id } }))) throw ProblemException.notFound('User');
  }

  private rolesOf(user: ProfileRow) {
    return effectiveRoles(
      user.roles.map((r) => r.role),
      user.directReports.length > 0,
    );
  }
}
