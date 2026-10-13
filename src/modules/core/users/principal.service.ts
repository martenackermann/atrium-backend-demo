import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import { type AssignableRole, ROLE_NAMES, type RoleName } from '@/common/domain/vocabulary';
import { PrismaService } from '@/database/prisma.service';
import type { PrismaTx } from '@/database/prisma.types';

/** employee (implicit) + manager (derived) + stored roles, in canonical order. */
export function effectiveRoles(stored: readonly AssignableRole[], hasActiveReports: boolean): RoleName[] {
  const set = new Set<RoleName>(['employee', ...stored]);
  if (hasActiveReports) set.add('manager');
  return ROLE_NAMES.filter((role) => set.has(role));
}

/** Loads the authenticated principal (with effective roles) for a user id. */
@Injectable()
export class PrincipalService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns null for unknown or inactive users. */
  async load(userId: string, sessionId: string | null, db: PrismaTx = this.prisma): Promise<AuthUser | null> {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        active: true,
        isSiteManager: true,
        roles: { select: { role: true } },
        _count: { select: { directReports: { where: { active: true } } } },
      },
    });
    if (!user?.active) return null;
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: effectiveRoles(
        user.roles.map((r) => r.role),
        user._count.directReports > 0,
      ),
      isSiteManager: user.isSiteManager,
      sessionId,
    };
  }

  async rolesOf(userId: string, db: PrismaTx = this.prisma): Promise<RoleName[]> {
    const [stored, reports] = await Promise.all([
      db.userRole.findMany({ where: { userId }, select: { role: true } }),
      db.user.count({ where: { managerId: userId, active: true } }),
    ]);
    return effectiveRoles(
      stored.map((r) => r.role),
      reports > 0,
    );
  }
}
