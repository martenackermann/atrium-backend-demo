import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import { hasRole } from '@/common/auth/auth-user';
import { toUserRef } from '@/common/domain/mappers';
import { ProblemException } from '@/common/http/problem';
import { Clock } from '@/common/time/clock.service';
import { dateFromIso, type IsoDate, isoFromDateOrNull } from '@/common/time/time';
import { PrismaService } from '@/database/prisma.service';
import type { PrismaTx } from '@/database/prisma.types';
import type { Prisma } from '@/generated/prisma/client';
import { AuditService, diffFields } from '../audit/audit.service';
import { deputyAssignedNotification } from '../mail/deputy-assigned.notification';
import { NotificationService } from '../notifications/notification.service';
import type { CreateDeputyDto, DeputyDto, UpdateDeputyDto } from './deputies.dto';

type DeputyRow = Prisma.DeputyGetPayload<{ include: { principal: true; deputy: true } }>;

/** Windows overlap when neither ends before the other starts (null = open). */
export function windowsOverlap(
  a: { from: IsoDate | null; to: IsoDate | null },
  b: { from: IsoDate | null; to: IsoDate | null },
): boolean {
  const aEndsBeforeB = a.to !== null && b.from !== null && a.to < b.from;
  const bEndsBeforeA = b.to !== null && a.from !== null && b.to < a.from;
  return !aEndsBeforeB && !bEndsBeforeA;
}

@Injectable()
export class DeputiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly clock: Clock,
  ) {}

  async mine(userId: string): Promise<{ asPrincipal: DeputyDto[]; asDeputy: DeputyDto[] }> {
    const include = { principal: true, deputy: true } as const;
    const [asPrincipal, asDeputy] = await Promise.all([
      this.prisma.deputy.findMany({
        where: { principalId: userId },
        include,
        orderBy: [{ validFrom: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.deputy.findMany({
        where: { deputyId: userId },
        include,
        orderBy: [{ validFrom: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);
    return { asPrincipal: asPrincipal.map((d) => this.toDto(d)), asDeputy: asDeputy.map((d) => this.toDto(d)) };
  }

  async create(actor: AuthUser, dto: CreateDeputyDto): Promise<DeputyDto> {
    const isAdmin = hasRole(actor, 'it_admin');
    const principalId = dto.principalId ?? actor.id;
    if (principalId !== actor.id && !isAdmin) {
      throw ProblemException.forbidden('Only it_admin can manage deputies of other users.');
    }
    if (principalId === actor.id && !hasRole(actor, 'manager', 'executive') && !isAdmin) {
      throw ProblemException.forbidden('Only managers and executives can name deputies.');
    }
    if (dto.deputyId === principalId)
      throw ProblemException.fieldError('deputyId', 'A user cannot be their own deputy.');
    this.assertWindow(dto.validFrom, dto.validTo);

    return this.prisma.$transaction(async (tx) => {
      const deputy = await tx.user.findUnique({ where: { id: dto.deputyId } });
      if (!deputy?.active) throw ProblemException.fieldError('deputyId', 'Choose an active user.');
      if (principalId !== actor.id && !(await tx.user.count({ where: { id: principalId } }))) {
        throw ProblemException.fieldError('principalId', 'Unknown user.');
      }
      await this.assertNoOverlap(tx, principalId, dto.deputyId, dto.validFrom, dto.validTo);

      const row = await tx.deputy.create({
        data: {
          principalId,
          deputyId: dto.deputyId,
          validFrom: dto.validFrom ? dateFromIso(dto.validFrom) : null,
          validTo: dto.validTo ? dateFromIso(dto.validTo) : null,
          note: dto.note,
          createdById: actor.id,
        },
        include: { principal: true, deputy: true },
      });
      await this.audit.record(
        {
          module: 'core',
          entityType: 'deputy',
          entityId: row.id,
          action: 'create',
          actorId: actor.id,
          actingAs: principalId === actor.id ? 'self' : 'admin',
          entityLabel: `${row.principal.displayName} → ${row.deputy.displayName}`,
          metadata: { deputyId: row.deputyId, validFrom: dto.validFrom, validTo: dto.validTo },
        },
        tx,
      );
      await this.notifications.send(
        deputyAssignedNotification,
        {
          to: [{ userId: row.deputyId }],
          context: {
            principalName: row.principal.displayName,
            deputyName: row.deputy.displayName,
            validFrom: dto.validFrom,
            validTo: dto.validTo,
            note: dto.note,
          },
          entity: { type: 'deputy', id: row.id },
        },
        { tx },
      );
      return this.toDto(row);
    });
  }

  async update(actor: AuthUser, id: string, dto: UpdateDeputyDto): Promise<DeputyDto> {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.findOwn(tx, actor, id);
      const before = {
        validFrom: isoFromDateOrNull(row.validFrom),
        validTo: isoFromDateOrNull(row.validTo),
        note: row.note,
      };
      const after = {
        validFrom: dto.validFrom === undefined ? before.validFrom : dto.validFrom,
        validTo: dto.validTo === undefined ? before.validTo : dto.validTo,
        note: dto.note === undefined ? before.note : dto.note,
      };
      this.assertWindow(after.validFrom, after.validTo);
      await this.assertNoOverlap(tx, row.principalId, row.deputyId, after.validFrom, after.validTo, row.id);

      const updated = await tx.deputy.update({
        where: { id },
        data: {
          validFrom: after.validFrom ? dateFromIso(after.validFrom) : null,
          validTo: after.validTo ? dateFromIso(after.validTo) : null,
          note: after.note,
        },
        include: { principal: true, deputy: true },
      });
      const changes = diffFields(before, after, { validFrom: 'Valid from', validTo: 'Valid to', note: 'Note' });
      if (changes.length) {
        await this.audit.record(
          {
            module: 'core',
            entityType: 'deputy',
            entityId: id,
            action: 'update',
            actorId: actor.id,
            actingAs: 'self',
            changes,
            entityLabel: `${updated.principal.displayName} → ${updated.deputy.displayName}`,
          },
          tx,
        );
      }
      return this.toDto(updated);
    });
  }

  async remove(actor: AuthUser, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const row = await this.findOwn(tx, actor, id);
      await tx.deputy.delete({ where: { id } });
      await this.audit.record(
        {
          module: 'core',
          entityType: 'deputy',
          entityId: id,
          action: 'delete',
          actorId: actor.id,
          actingAs: 'self',
          entityLabel: `${row.principal.displayName} → ${row.deputy.displayName}`,
        },
        tx,
      );
    });
  }

  toDto(row: DeputyRow): DeputyDto {
    const validFrom = isoFromDateOrNull(row.validFrom);
    const validTo = isoFromDateOrNull(row.validTo);
    const today = this.clock.today();
    const state =
      validFrom !== null && validFrom > today ? 'upcoming' : validTo !== null && validTo < today ? 'expired' : 'active';
    return {
      id: row.id,
      principal: toUserRef(row.principal),
      deputy: toUserRef(row.deputy),
      validFrom,
      validTo,
      note: row.note,
      isActiveNow: state === 'active' && row.principal.active && row.deputy.active,
      state,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** The principal manages their own deputies; it_admin manages anyone's (SPEC_RESOLUTIONS #24). */
  private async findOwn(tx: PrismaTx, actor: AuthUser, id: string): Promise<DeputyRow> {
    const row = await tx.deputy.findUnique({ where: { id }, include: { principal: true, deputy: true } });
    if (!row || (row.principalId !== actor.id && !hasRole(actor, 'it_admin')))
      throw ProblemException.notFound('Deputy');
    return row;
  }

  private assertWindow(validFrom: IsoDate | null, validTo: IsoDate | null): void {
    if (validFrom && validTo && validTo < validFrom) {
      throw ProblemException.fieldError('validTo', 'The end date must be on or after the start date.');
    }
  }

  private async assertNoOverlap(
    tx: PrismaTx,
    principalId: string,
    deputyId: string,
    validFrom: IsoDate | null,
    validTo: IsoDate | null,
    excludeId?: string,
  ): Promise<void> {
    const existing = await tx.deputy.findMany({
      where: { principalId, deputyId, ...(excludeId ? { id: { not: excludeId } } : {}) },
    });
    const clash = existing.some((d) =>
      windowsOverlap(
        { from: isoFromDateOrNull(d.validFrom), to: isoFromDateOrNull(d.validTo) },
        { from: validFrom, to: validTo },
      ),
    );
    if (clash) {
      throw ProblemException.conflict('This deputy already has an overlapping window.', 'deputy_overlap');
    }
  }
}
