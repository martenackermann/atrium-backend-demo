import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  actingAsSchema,
  assignableRoleSchema,
  isoDateSchema,
  isoDateTimeSchema,
  moduleNameSchema,
  personaKeySchema,
  refSchema,
  timelineEntrySchema,
  userRefSchema,
  userSummarySchema,
} from '@/common/domain/schemas';
import { paginatedSchema, paginationQuerySchema } from '@/common/http/pagination';
import { sortParam } from '@/common/http/sort';

const booleanQuery = z.enum(['true', 'false']).transform((v) => v === 'true');
const nameSchema = z.string().trim().min(1).max(100);

export const adminUserSchema = userSummarySchema.extend({
  firstName: z.string(),
  lastName: z.string(),
  employeeNumber: z.string(),
  phone: z.string().nullable(),
  manager: userRefSchema.nullable(),
  costCenter: refSchema,
  roles: z.array(assignableRoleSchema),
  isSiteManager: z.boolean(),
  isManager: z.boolean(),
  directReportsCount: z.number().int(),
  personaKey: personaKeySchema.nullable(),
  lastLoginAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  /** Optimistic locking: send it back in PATCH (SPEC_RESOLUTIONS #26). */
  version: z.number().int(),
});
export class AdminUserDto extends createZodDto(adminUserSchema) {}
export class AdminUserPageDto extends createZodDto(paginatedSchema(adminUserSchema)) {}

export const listAdminUsersQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  role: assignableRoleSchema.optional(),
  departmentId: z.uuid().optional(),
  active: booleanQuery.optional(),
  sort: sortParam({ allowed: ['displayName', 'lastLoginAt'], default: 'displayName' }),
});
export class ListAdminUsersQuery extends createZodDto(listAdminUsersQuerySchema) {}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const createAdminUserSchema = z.strictObject({
  email: z.email().trim().toLowerCase().max(200),
  firstName: nameSchema,
  lastName: nameSchema,
  jobTitle: optionalText(200),
  employeeNumber: optionalText(20),
  departmentId: z.uuid().nullish(),
  siteId: z.uuid().nullish(),
  costCenterId: z.uuid(),
  managerId: z.uuid().nullish(),
  isSiteManager: z.boolean().optional(),
  roles: z.array(assignableRoleSchema).max(7).optional(),
  initialPassword: z.string().min(8).max(200),
});
export class CreateAdminUserDto extends createZodDto(createAdminUserSchema) {}

export const updateAdminUserSchema = z.strictObject({
  firstName: nameSchema.optional(),
  lastName: nameSchema.optional(),
  jobTitle: optionalText(200).optional(),
  employeeNumber: z.string().trim().min(1).max(20).optional(),
  departmentId: z.uuid().nullish(),
  siteId: z.uuid().nullish(),
  costCenterId: z.uuid().optional(),
  managerId: z.uuid().nullish(),
  isSiteManager: z.boolean().optional(),
  roles: z.array(assignableRoleSchema).max(7).optional(),
  active: z.boolean().optional(),
  version: z.number().int().optional(),
});
export class UpdateAdminUserDto extends createZodDto(updateAdminUserSchema) {}

export const jobRunSchema = z.object({
  id: z.uuid(),
  jobName: z.string(),
  triggeredBy: z.enum(['cron', 'manual']),
  triggeredByUser: userRefSchema.nullable(),
  startedAt: isoDateTimeSchema,
  finishedAt: isoDateTimeSchema.nullable(),
  status: z.enum(['running', 'succeeded', 'failed']),
  summary: z.record(z.string(), z.union([z.number(), z.string()])),
  error: z.string().nullable(),
});
export class JobRunPageDto extends createZodDto(paginatedSchema(jobRunSchema)) {}

export const jobSchema = z.object({
  name: z.string(),
  description: z.string(),
  slice: z.enum(['F', 'A1', 'A2', 'A3', 'A4']),
  cron: z.string().nullable(),
  enabled: z.boolean(),
  nextRunAt: isoDateTimeSchema.nullable(),
  lastRun: jobRunSchema.nullable(),
});
export class JobDto extends createZodDto(jobSchema) {}
export class JobRunStartedDto extends createZodDto(z.object({ jobRunId: z.uuid() })) {}

export const auditEntrySchema = timelineEntrySchema.extend({ module: moduleNameSchema, correlationId: z.string() });
export class AuditEntryPageDto extends createZodDto(paginatedSchema(auditEntrySchema)) {}

export const listAuditQuerySchema = paginationQuerySchema.extend({
  module: moduleNameSchema.optional(),
  entityType: z.string().trim().max(60).optional(),
  entityId: z.uuid().optional(),
  actorId: z.uuid().optional(),
  action: z.string().trim().max(60).optional(),
  actingAs: actingAsSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  sort: sortParam({ allowed: ['occurredAt'], default: '-occurredAt' }),
});
export class ListAuditQuery extends createZodDto(listAuditQuerySchema) {}
