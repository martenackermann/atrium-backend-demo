import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from '@/common/domain/schemas';
import { paginatedSchema, paginationQuerySchema } from '@/common/http/pagination';
import { sortParam } from '@/common/http/sort';

const booleanQuery = z.enum(['true', 'false']).transform((v) => v === 'true');
const nameSchema = z.string().trim().min(1).max(120);
const deviceTypeIdsSchema = z.array(z.uuid()).max(20);

// --- responses ---------------------------------------------------------------

export const deviceTypeSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  name: z.string(),
  requiresPlatform: z.boolean(),
  sortOrder: z.number().int(),
  assetCount: z.number().int(),
});
export class DeviceTypeDto extends createZodDto(z.object(deviceTypeSchema.shape)) {}

export const manufacturerSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  deviceTypeIds: z.array(uuidSchema),
  archived: z.boolean(),
  modelCount: z.number().int(),
  assetCount: z.number().int(),
});
export class ManufacturerDto extends createZodDto(z.object(manufacturerSchema.shape)) {}

export const platformSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  deviceTypeIds: z.array(uuidSchema),
  archived: z.boolean(),
  assetCount: z.number().int(),
});
export class PlatformDto extends createZodDto(z.object(platformSchema.shape)) {}

export const assetModelSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  manufacturer: z.object({ id: uuidSchema, name: z.string() }),
  deviceType: z.object({ id: uuidSchema, code: z.string(), name: z.string() }),
  storageGb: z.number().int().nullable(),
  color: z.string().nullable(),
  archived: z.boolean(),
  /** Assets referencing the model, including soft-deleted ones (hard delete needs 0). */
  assetCount: z.number().int(),
  createdAt: isoDateTimeSchema,
});
export class AssetModelDto extends createZodDto(z.object(assetModelSchema.shape)) {}
export class AssetModelPageDto extends createZodDto(paginatedSchema(assetModelSchema)) {}

export type DeviceTypeView = z.infer<typeof deviceTypeSchema>;
export type ManufacturerView = z.infer<typeof manufacturerSchema>;
export type PlatformView = z.infer<typeof platformSchema>;
export type AssetModelView = z.infer<typeof assetModelSchema>;

// --- queries -----------------------------------------------------------------

export class CatalogFilterQuery extends createZodDto(
  z.object({ deviceTypeId: z.uuid().optional(), includeArchived: booleanQuery.default(false) }),
) {}

export class ListModelsQuery extends createZodDto(
  paginationQuerySchema.extend({
    deviceTypeId: z.uuid().optional(),
    manufacturerId: z.uuid().optional(),
    q: z.string().trim().max(100).optional(),
    includeArchived: booleanQuery.default(false),
    sort: sortParam({ allowed: ['name', 'assetCount'], default: 'name' }),
  }),
) {}

// --- bodies ------------------------------------------------------------------

export const createDeviceTypeSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/, 'Use lowercase letters, digits and underscores.'),
  name: nameSchema,
  requiresPlatform: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});
export class CreateDeviceTypeDto extends createZodDto(createDeviceTypeSchema) {}
export class UpdateDeviceTypeDto extends createZodDto(
  z.strictObject({
    code: createDeviceTypeSchema.shape.code.optional(),
    name: nameSchema.optional(),
    requiresPlatform: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  }),
) {}

export const createManufacturerSchema = z.strictObject({
  name: nameSchema,
  deviceTypeIds: deviceTypeIdsSchema,
  archived: z.boolean().optional(),
});
export class CreateManufacturerDto extends createZodDto(createManufacturerSchema) {}
export class UpdateManufacturerDto extends createZodDto(createManufacturerSchema.partial()) {}

export class CreatePlatformDto extends createZodDto(createManufacturerSchema) {}
export class UpdatePlatformDto extends createZodDto(createManufacturerSchema.partial()) {}

const colorSchema = z
  .string()
  .trim()
  .max(40)
  .nullish()
  .transform((v) => (v ? v : null));

export const createModelSchema = z.strictObject({
  name: nameSchema,
  manufacturerId: z.uuid(),
  deviceTypeId: z.uuid(),
  storageGb: z.number().int().min(1).max(100_000).nullish(),
  color: colorSchema,
  archived: z.boolean().optional(),
});
export class CreateModelDto extends createZodDto(createModelSchema) {}
export class UpdateModelDto extends createZodDto(
  z.strictObject({
    name: nameSchema.optional(),
    manufacturerId: z.uuid().optional(),
    deviceTypeId: z.uuid().optional(),
    storageGb: z.number().int().min(1).max(100_000).nullish(),
    color: colorSchema.optional(),
    archived: z.boolean().optional(),
  }),
) {}
