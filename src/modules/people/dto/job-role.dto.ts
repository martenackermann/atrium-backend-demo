import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { optionalTextSchema, uuidSchema } from '@/common/domain/schemas';

const booleanQuery = z.enum(['true', 'false']).transform((v) => v === 'true');

export const jobRoleSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  category: z.string().nullable(),
  active: z.boolean(),
});
export class JobRoleDto extends createZodDto(jobRoleSchema) {}
export class JobRoleListDto extends createZodDto(z.array(jobRoleSchema)) {}

export const createJobRoleSchema = z.strictObject({
  name: z.string().trim().min(2).max(100),
  category: optionalTextSchema(80),
  active: z.boolean().optional(),
});
export class CreateJobRoleDto extends createZodDto(createJobRoleSchema) {}

export const updateJobRoleSchema = z.strictObject({
  name: z.string().trim().min(2).max(100).optional(),
  category: optionalTextSchema(80).optional(),
  active: z.boolean().optional(),
});
export class UpdateJobRoleDto extends createZodDto(updateJobRoleSchema) {}

export const listJobRolesQuerySchema = z.object({ includeInactive: booleanQuery.default(false) });
export class ListJobRolesQuery extends createZodDto(listJobRolesQuerySchema) {}
