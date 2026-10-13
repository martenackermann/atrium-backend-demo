import { Injectable } from '@nestjs/common';
import { type AuthUser, hasRole } from '@/common/auth/auth-user';
import { defaultActingAs } from '@/modules/core/workflow/workflow.service';
import { ProblemException } from '@/common/http/problem';
import { PrismaService } from '@/database/prisma.service';
import type { PrismaTx } from '@/database/prisma.types';
import { Prisma, type CarRentalClass } from '@/generated/prisma/client';
import { AuditService } from '@/modules/core/audit/audit.service';
import type { CarRentalClassView, CreateCarClassInput, UpdateCarClassInput } from '../dto/car-class.dto';
import { CAR_CLASS_ENTITY, type VehicleType } from '../travel.constants';

const AUDITED_FIELDS = [
  'code',
  'name',
  'description',
  'exampleModels',
  'vehicleType',
  'isDefault',
  'sortOrder',
  'active',
] as const;

export function toCarClassView(row: CarRentalClass): CarRentalClassView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    exampleModels: row.exampleModels,
    vehicleType: row.vehicleType,
    isDefault: row.isDefault,
    sortOrder: row.sortOrder,
    active: row.active,
  };
}

/**
 * Car-rental class catalogue (SPEC §4.3, API.md §5.1). Exactly one active default
 * ("Standard") per vehicle type: making a class default clears the previous one, and the
 * current default cannot be unset, deactivated or moved to another vehicle type (422).
 */
@Injectable()
export class CarClassesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private isBackOffice(user: AuthUser): boolean {
    return hasRole(user, 'travel_desk', 'it_admin');
  }

  async list(user: AuthUser, query: { vehicleType?: VehicleType; includeInactive?: boolean }) {
    const includeInactive = query.includeInactive === true && this.isBackOffice(user);
    const rows = await this.prisma.carRentalClass.findMany({
      where: {
        ...(query.vehicleType ? { vehicleType: query.vehicleType } : {}),
        ...(includeInactive ? {} : { active: true }),
      },
      orderBy: [{ vehicleType: 'asc' }, { sortOrder: 'asc' }, { code: 'asc' }],
    });
    return rows.map(toCarClassView);
  }

  async create(user: AuthUser, input: CreateCarClassInput): Promise<CarRentalClassView> {
    if (input.isDefault && !input.active)
      throw ProblemException.fieldError('active', 'The standard class must be active.');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existingDefault = await tx.carRentalClass.findFirst({
          where: { vehicleType: input.vehicleType, isDefault: true },
        });
        const isDefault = input.isDefault || !existingDefault; // the first class of a type becomes the standard
        if (isDefault && !input.active)
          throw ProblemException.fieldError('active', 'The standard class must be active.');
        if (isDefault && existingDefault) await this.clearDefault(tx, user, existingDefault);
        const row = await tx.carRentalClass.create({ data: { ...input, isDefault } });
        await this.audit.record(
          {
            module: 'travel',
            entityType: CAR_CLASS_ENTITY,
            entityId: row.id,
            action: 'create',
            actorId: user.id,
            actingAs: defaultActingAs(user, 'travel'),
            entityLabel: `${row.code} ${row.name}`,
          },
          tx,
        );
        return toCarClassView(row);
      });
    } catch (error) {
      throw this.mapUniqueError(error);
    }
  }

  async update(user: AuthUser, id: string, input: UpdateCarClassInput): Promise<CarRentalClassView> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await tx.carRentalClass.findUnique({ where: { id } });
        if (!current) throw ProblemException.notFound('Car class');
        const next = { ...current, ...input };
        if (current.isDefault) {
          if (input.isDefault === false) {
            throw ProblemException.fieldError('isDefault', 'Make another class the standard first.');
          }
          if (input.active === false) {
            throw ProblemException.fieldError(
              'active',
              'The standard class cannot be deactivated. Make another class the standard first.',
            );
          }
          if (input.vehicleType && input.vehicleType !== current.vehicleType) {
            throw ProblemException.fieldError('vehicleType', 'The standard class cannot change its vehicle type.');
          }
        }
        if (next.isDefault && !next.active)
          throw ProblemException.fieldError('active', 'The standard class must be active.');
        if (input.isDefault === true && !current.isDefault) {
          const previous = await tx.carRentalClass.findFirst({
            where: { vehicleType: next.vehicleType, isDefault: true, id: { not: id } },
          });
          if (previous) await this.clearDefault(tx, user, previous);
        }
        const row = await tx.carRentalClass.update({ where: { id }, data: input });
        const changes = this.audit.diff(CAR_CLASS_ENTITY, current, row, [...AUDITED_FIELDS]);
        if (changes.length) {
          await this.audit.record(
            {
              module: 'travel',
              entityType: CAR_CLASS_ENTITY,
              entityId: id,
              action: 'update',
              actorId: user.id,
              actingAs: defaultActingAs(user, 'travel'),
              changes,
              entityLabel: `${row.code} ${row.name}`,
            },
            tx,
          );
        }
        return toCarClassView(row);
      });
    } catch (error) {
      throw this.mapUniqueError(error);
    }
  }

  private async clearDefault(tx: PrismaTx, user: AuthUser, previous: CarRentalClass): Promise<void> {
    await tx.carRentalClass.update({ where: { id: previous.id }, data: { isDefault: false } });
    await this.audit.record(
      {
        module: 'travel',
        entityType: CAR_CLASS_ENTITY,
        entityId: previous.id,
        action: 'update',
        actorId: user.id,
        actingAs: defaultActingAs(user, 'travel'),
        changes: [{ field: 'isDefault', label: 'Standard class', from: true, to: false }],
        entityLabel: `${previous.code} ${previous.name}`,
      },
      tx,
    );
  }

  private mapUniqueError(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return ProblemException.conflict('A car class with this code already exists.');
    }
    return error;
  }
}
