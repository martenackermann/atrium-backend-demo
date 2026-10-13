import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { paginatedSchema, paginationQuerySchema } from '@/common/http/pagination';
import { sortParam } from '@/common/http/sort';
import {
  approverCandidateSchema,
  isoDateSchema,
  personaKeySchema,
  refSchema,
  roleNameSchema,
  userRefSchema,
  userSummarySchema,
} from '@/common/domain/schemas';

const booleanQuery = z.enum(['true', 'false']).transform((v) => v === 'true');

export const meSchema = userSummarySchema.extend({
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string().nullable(),
  roles: z.array(roleNameSchema),
  isManager: z.boolean(),
  isExecutive: z.boolean(),
  isSiteManager: z.boolean(),
  manager: userRefSchema.nullable(),
  costCenter: refSchema,
  activeDeputyFor: z.array(
    z.object({ principal: userRefSchema, validFrom: isoDateSchema.nullable(), validTo: isoDateSchema.nullable() }),
  ),
  personaKey: personaKeySchema.nullable(),
});
export class MeDto extends createZodDto(meSchema) {}

export const userProfileSchema = userSummarySchema.extend({
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string().nullable(),
  manager: userRefSchema.nullable(),
  directReports: z.array(userRefSchema),
  costCenter: refSchema,
  roles: z.array(roleNameSchema),
  isSiteManager: z.boolean(),
});
export class UserProfileDto extends createZodDto(userProfileSchema) {}

export const listUsersQuerySchema = paginationQuerySchema.extend({
  perPage: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
  departmentId: z.uuid().optional(),
  siteId: z.uuid().optional(),
  role: roleNameSchema.optional(),
  scope: z.enum(['all', 'team']).default('all'),
  includeInactive: booleanQuery.default(false),
  sort: sortParam({ allowed: ['displayName'], default: 'displayName' }),
});
export class ListUsersQuery extends createZodDto(listUsersQuerySchema) {}

export class UserSummaryPageDto extends createZodDto(paginatedSchema(userSummarySchema)) {}

export const approverChainSchema = z.object({
  subject: userRefSchema,
  exemption: z.enum(['executive_traveller']).nullable(),
  default: approverCandidateSchema.nullable(),
  candidates: z.array(approverCandidateSchema),
});
export class ApproverChainDto extends createZodDto(approverChainSchema) {}

export const departmentSchema = refSchema.extend({ head: userRefSchema.nullable(), memberCount: z.number().int() });
export class DepartmentDto extends createZodDto(departmentSchema) {}

export const costCenterSchema = refSchema.extend({ department: refSchema.nullable(), active: z.boolean() });
export class CostCenterDto extends createZodDto(costCenterSchema) {}

export const listCostCentersQuerySchema = z.object({ active: booleanQuery.optional() });
export class ListCostCentersQuery extends createZodDto(listCostCentersQuerySchema) {}
