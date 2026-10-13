import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import { hasRole } from '@/common/auth/auth-user';
import { ProblemException } from '@/common/http/problem';
import { PrismaService } from '@/database/prisma.service';
import type { PrismaTx } from '@/database/prisma.types';
import { AuditService } from '@/modules/core/audit/audit.service';
import type { z } from 'zod';
import type { createJobRoleSchema, updateJobRoleSchema } from '../dto/job-role.dto';
import { isPeopleBackOffice } from '../people.constants';

type JobRoleRow = { id: string; name: string; category: string | null; active: boolean };

const view = (row: JobRoleRow) => ({ id: row.id, name: row.name, category: row.category, active: row.active });

/** The job-role catalogue (SPEC §4.5): readable by everyone, managed by People Ops. */
@Injectable()
export class JobRolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser, includeInactive: boolean) {
    const rows = await this.prisma.jobRole.findMany({
      where: includeInactive && isPeopleBackOffice(user) ? {} : { active: true },
      orderBy: { name: 'asc' },
    });
    return rows.map(view);
  }

  async create(user: AuthUser, input: z.infer<typeof createJobRoleSchema>) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertUniqueName(tx, input.name);
      const row = await tx.jobRole.create({
        data: { name: input.name, category: input.category ?? null, active: input.active ?? true },
      });
      await this.audit.record(
        {
          module: 'people',
          entityType: 'job_role',
          entityId: row.id,
          action: 'create',
          actorId: user.id,
          actingAs: hasRole(user, 'people_ops') ? 'back_office' : 'admin',
          entityLabel: row.name,
        },
        tx,
      );
      return view(row);
    });
  }

  async update(user: AuthUser, id: string, input: z.infer<typeof updateJobRoleSchema>) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.jobRole.findUnique({ where: { id } });
      if (!before) throw ProblemException.notFound('Job role');
      if (input.name !== undefined && input.name.toLowerCase() !== before.name.toLowerCase()) {
        await this.assertUniqueName(tx, input.name, id);
      }
      const row = await tx.jobRole.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        },
      });
      const changes = this.audit.diff('job_role', before, row);
      await this.audit.record(
        {
          module: 'people',
          entityType: 'job_role',
          entityId: id,
          action: 'update',
          actorId: user.id,
          actingAs: hasRole(user, 'people_ops') ? 'back_office' : 'admin',
          changes: changes.length ? changes : null,
          entityLabel: row.name,
        },
        tx,
      );
      return view(row);
    });
  }

  private async assertUniqueName(tx: PrismaTx, name: string, exceptId?: string): Promise<void> {
    const clash = await tx.jobRole.findFirst({
      where: { name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    if (clash) throw ProblemException.conflict(`A job role named "${clash.name}" already exists.`);
  }
}
