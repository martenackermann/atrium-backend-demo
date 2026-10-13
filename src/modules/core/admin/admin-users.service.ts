import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import { hashPassword } from '@/common/auth/password-hasher';
import { toRef, toUserRefOrNull, toUserSummary, userSummaryInclude } from '@/common/domain/mappers';
import type { PersonaKey } from '@/common/domain/vocabulary';
import { paginate, type Paginated } from '@/common/http/pagination';
import { ProblemException } from '@/common/http/problem';
import { toPrismaOrderBy } from '@/common/http/sort';
import { PrismaService } from '@/database/prisma.service';
import type { PrismaTx } from '@/database/prisma.types';
import type { Prisma } from '@/generated/prisma/client';
import { AuditService, diffFields } from '../audit/audit.service';
import type { AdminUserDto, CreateAdminUserDto, ListAdminUsersQuery, UpdateAdminUserDto } from './admin.dto';

const include = {
  ...userSummaryInclude,
  costCenter: true,
  manager: true,
  roles: { select: { role: true }, orderBy: { role: 'asc' } },
  _count: { select: { directReports: { where: { active: true } } } },
} satisfies Prisma.UserInclude;

type Row = Prisma.UserGetPayload<{ include: typeof include }>;

const LABELS = {
  firstName: 'First name',
  lastName: 'Last name',
  jobTitle: 'Job title',
  employeeNumber: 'Employee number',
  departmentId: 'Department',
  siteId: 'Site',
  costCenterId: 'Cost centre',
  managerId: 'Manager',
  isSiteManager: 'Site manager',
  active: 'Active',
  roles: 'Roles',
} as const;

/** `/admin/users` (it_admin): user and role administration. */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListAdminUsersQuery): Promise<Paginated<AdminUserDto>> {
    const and: Prisma.UserWhereInput[] = [];
    if (query.q) {
      and.push({
        OR: [
          { displayName: { contains: query.q, mode: 'insensitive' } },
          { email: { contains: query.q, mode: 'insensitive' } },
          { employeeNumber: { equals: query.q, mode: 'insensitive' } },
        ],
      });
    }
    if (query.role) and.push({ roles: { some: { role: query.role } } });
    if (query.departmentId) and.push({ departmentId: query.departmentId });
    if (query.active !== undefined) and.push({ active: query.active });
    const where = { AND: and };
    const orderBy = [...toPrismaOrderBy(query.sort), { id: 'asc' }] as Prisma.UserOrderByWithRelationInput[];
    return paginate(
      query,
      async (page) => (await this.prisma.user.findMany({ where, orderBy, include, ...page })).map((r) => this.toDto(r)),
      () => this.prisma.user.count({ where }),
    );
  }

  async get(id: string): Promise<AdminUserDto> {
    const row = await this.prisma.user.findUnique({ where: { id }, include });
    if (!row) throw ProblemException.notFound('User');
    return this.toDto(row);
  }

  async create(actor: AuthUser, dto: CreateAdminUserDto): Promise<AdminUserDto> {
    if (await this.prisma.user.count({ where: { email: dto.email } })) {
      throw ProblemException.conflict('A user with this email already exists.');
    }
    const passwordHash = await hashPassword(dto.initialPassword);
    return this.prisma.$transaction(async (tx) => {
      await this.assertReferences(tx, dto);
      const employeeNumber = dto.employeeNumber ?? (await this.nextEmployeeNumber(tx));
      const created = await tx.user.create({
        data: {
          email: dto.email,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
          displayName: `${dto.firstName} ${dto.lastName}`,
          jobTitle: dto.jobTitle,
          employeeNumber,
          departmentId: dto.departmentId ?? null,
          siteId: dto.siteId ?? null,
          costCenterId: dto.costCenterId,
          managerId: dto.managerId ?? null,
          isSiteManager: dto.isSiteManager ?? false,
          roles: { create: (dto.roles ?? []).map((role) => ({ role, grantedById: actor.id })) },
        },
        include,
      });
      await this.audit.record(
        {
          module: 'core',
          entityType: 'user',
          entityId: created.id,
          action: 'create',
          actorId: actor.id,
          actingAs: 'admin',
          entityLabel: created.displayName,
          metadata: { roles: dto.roles ?? [] },
        },
        tx,
      );
      return this.toDto(created);
    });
  }

  async update(actor: AuthUser, id: string, dto: UpdateAdminUserDto): Promise<AdminUserDto> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({ where: { id }, include });
      if (!before) throw ProblemException.notFound('User');
      if (dto.version !== undefined && dto.version !== before.version) throw ProblemException.versionConflict();
      await this.assertReferences(tx, dto);
      if (dto.managerId) await this.assertNoCycle(tx, id, dto.managerId);
      const beforeRoles = before.roles.map((r) => r.role);
      if (id === actor.id && dto.roles && beforeRoles.includes('it_admin') && !dto.roles.includes('it_admin')) {
        throw ProblemException.fieldError('roles', 'You cannot remove your own it_admin role.');
      }
      if (id === actor.id && dto.active === false)
        throw ProblemException.fieldError('active', 'You cannot deactivate yourself.');

      const firstName = dto.firstName ?? before.firstName;
      const lastName = dto.lastName ?? before.lastName;
      await tx.user.update({
        where: { id },
        data: {
          firstName,
          lastName,
          displayName: `${firstName} ${lastName}`,
          ...(dto.jobTitle !== undefined ? { jobTitle: dto.jobTitle } : {}),
          ...(dto.employeeNumber !== undefined ? { employeeNumber: dto.employeeNumber } : {}),
          ...(dto.departmentId !== undefined ? { departmentId: dto.departmentId } : {}),
          ...(dto.siteId !== undefined ? { siteId: dto.siteId } : {}),
          ...(dto.costCenterId !== undefined ? { costCenterId: dto.costCenterId } : {}),
          ...(dto.managerId !== undefined ? { managerId: dto.managerId } : {}),
          ...(dto.isSiteManager !== undefined ? { isSiteManager: dto.isSiteManager } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
          version: { increment: 1 },
        },
      });
      if (dto.roles) {
        const removed = beforeRoles.filter((r) => !dto.roles!.includes(r));
        const added = dto.roles.filter((r) => !beforeRoles.includes(r));
        await tx.userRole.deleteMany({ where: { userId: id, role: { in: removed } } });
        if (added.length)
          await tx.userRole.createMany({ data: added.map((role) => ({ userId: id, role, grantedById: actor.id })) });
      }
      // Roles are loaded per request, so changes apply to existing sessions immediately.
      if (dto.active === false) {
        await tx.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      }

      const after = await tx.user.findUniqueOrThrow({ where: { id }, include });
      const changes = diffFields(
        { ...this.plain(before), roles: beforeRoles.slice().sort() },
        { ...this.plain(after), roles: after.roles.map((r) => r.role).sort() },
        LABELS,
      );
      if (changes.length) {
        await this.audit.record(
          {
            module: 'core',
            entityType: 'user',
            entityId: id,
            action: 'update',
            actorId: actor.id,
            actingAs: 'admin',
            changes,
            entityLabel: after.displayName,
          },
          tx,
        );
      }
      return this.toDto(after);
    });
  }

  toDto(row: Row): AdminUserDto {
    return {
      ...toUserSummary(row),
      firstName: row.firstName,
      lastName: row.lastName,
      employeeNumber: row.employeeNumber,
      phone: row.phone,
      manager: toUserRefOrNull(row.manager),
      costCenter: toRef(row.costCenter),
      roles: row.roles.map((r) => r.role),
      isSiteManager: row.isSiteManager,
      isManager: row._count.directReports > 0,
      directReportsCount: row._count.directReports,
      personaKey: (row.personaKey as PersonaKey | null) ?? null,
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      version: row.version,
    };
  }

  private plain(row: Row) {
    return {
      firstName: row.firstName,
      lastName: row.lastName,
      jobTitle: row.jobTitle,
      employeeNumber: row.employeeNumber,
      departmentId: row.departmentId,
      siteId: row.siteId,
      costCenterId: row.costCenterId,
      managerId: row.managerId,
      isSiteManager: row.isSiteManager,
      active: row.active,
    };
  }

  private async assertReferences(
    tx: PrismaTx,
    dto: { departmentId?: string | null; siteId?: string | null; costCenterId?: string; managerId?: string | null },
  ): Promise<void> {
    const errors: Record<string, string[]> = {};
    if (dto.departmentId && !(await tx.department.count({ where: { id: dto.departmentId } })))
      errors.departmentId = ['Unknown department.'];
    if (dto.siteId && !(await tx.site.count({ where: { id: dto.siteId } }))) errors.siteId = ['Unknown site.'];
    if (dto.costCenterId && !(await tx.costCenter.count({ where: { id: dto.costCenterId } })))
      errors.costCenterId = ['Unknown cost centre.'];
    if (dto.managerId && !(await tx.user.count({ where: { id: dto.managerId, active: true } })))
      errors.managerId = ['Choose an active user.'];
    if (Object.keys(errors).length) throw ProblemException.validation(errors);
  }

  /** Rejects a manager assignment that would create a reporting cycle (SPEC §4.1). */
  private async assertNoCycle(tx: PrismaTx, userId: string, managerId: string): Promise<void> {
    let current: string | null = managerId;
    for (let depth = 0; current && depth < 50; depth++) {
      if (current === userId) throw ProblemException.fieldError('managerId', 'This would create a reporting cycle.');
      const next: { managerId: string | null } | null = await tx.user.findUnique({
        where: { id: current },
        select: { managerId: true },
      });
      current = next?.managerId ?? null;
    }
  }

  private async nextEmployeeNumber(tx: PrismaTx): Promise<string> {
    const rows = await tx.user.findMany({ select: { employeeNumber: true } });
    const max = rows.reduce((m, r) => Math.max(m, Number(/^E(\d+)$/.exec(r.employeeNumber)?.[1] ?? 0)), 10000);
    return `E${max + 1}`;
  }
}
