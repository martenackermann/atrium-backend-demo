import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  isoDateSchema,
  isoDateTimeSchema,
  optionalTextSchema,
  reasonSchema,
  refSchema,
  timelineEntrySchema,
  userRefSchema,
  uuidSchema,
} from '@/common/domain/schemas';
import { paginatedSchema, paginationQuerySchema } from '@/common/http/pagination';
import { sortParam } from '@/common/http/sort';
import { ASSET_ACTIONS, ASSET_STATUSES, RETURN_CONDITIONS } from '../assets.domain';

// --- shared pieces ------------------------------------------------------------

export const assetStatusSchema = z.enum(ASSET_STATUSES).meta({ id: 'AssetStatus' });
export const returnConditionSchema = z.enum(RETURN_CONDITIONS).meta({ id: 'ReturnCondition' });
export const assetActionSchema = z.enum(ASSET_ACTIONS).meta({ id: 'AssetAction' });

const idName = z.object({ id: uuidSchema, name: z.string() });
export const deviceTypeRefSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  name: z.string(),
  requiresPlatform: z.boolean(),
});

const booleanQuery = z.enum(['true', 'false']).transform((v) => v === 'true');

/** Comma-separated list (`?status=in_use,in_repair`), validated item by item. */
function csvOf<T extends z.ZodType<unknown, string>>(item: T) {
  return z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    )
    .pipe(z.array(item));
}

// --- responses ---------------------------------------------------------------

export const assetAssignmentSchema = z.object({
  id: uuidSchema,
  user: userRefSchema,
  assignedBy: userRefSchema,
  assignedAt: isoDateTimeSchema,
  note: z.string().nullable(),
  acceptedAt: isoDateTimeSchema.nullable(),
  declinedAt: isoDateTimeSchema.nullable(),
  declineReason: z.string().nullable(),
  unassignedAt: isoDateTimeSchema.nullable(),
  returnedAt: isoDateTimeSchema.nullable(),
  returnCondition: returnConditionSchema.nullable(),
  returnNote: z.string().nullable(),
  reminderCount: z.number().int(),
});
export class AssetAssignmentDto extends createZodDto(z.object(assetAssignmentSchema.shape)) {}

export const assetListItemSchema = z
  .object({
    id: uuidSchema,
    assetTag: z.string(),
    serialNumber: z.string(),
    name: z.string().nullable(),
    deviceType: deviceTypeRefSchema,
    manufacturer: idName,
    model: idName,
    platform: idName.nullable(),
    status: assetStatusSchema,
    assignedUser: userRefSchema.nullable(),
    costCenter: refSchema,
    purchaseDate: isoDateSchema.nullable(),
    mdmEnrolled: z.boolean(),
    deletedAt: isoDateTimeSchema.nullable(),
    updatedAt: isoDateTimeSchema,
    availableActions: z.array(assetActionSchema),
  })
  .meta({ id: 'AssetListItem' });

export const assetSchema = assetListItemSchema.extend({
  /** Always null for non-admins (SPEC §3.3). */
  notes: z.string().nullable(),
  currentAssignment: assetAssignmentSchema.nullable(),
  /** Non-archived platforms for the device type (accept dialog). */
  applicablePlatforms: z.array(idName),
  createdBy: userRefSchema.nullable(),
  createdAt: isoDateTimeSchema,
  version: z.number().int(),
});
export class AssetDto extends createZodDto(z.object(assetSchema.shape)) {}
export type AssetView = z.infer<typeof assetSchema>;
export type AssetListItemView = z.infer<typeof assetListItemSchema>;
export type AssetAssignmentView = z.infer<typeof assetAssignmentSchema>;

export class AssetPageDto extends createZodDto(paginatedSchema(assetListItemSchema)) {}

export class MyAssetsDto extends createZodDto(
  z.object({ pending: z.array(assetSchema), active: z.array(assetSchema) }),
) {}

export class AssetTimelineEntryDto extends createZodDto(z.object(timelineEntrySchema.shape)) {}

export const assetQueueCountsSchema = z.object({
  mine: z.object({ pending: z.number().int() }),
  admin: z
    .object({
      pendingAcceptance: z.number().int(),
      acceptanceOverdue: z.number().int(),
      inRepair: z.number().int(),
      inStock: z.number().int(),
    })
    .nullable(),
});
export class AssetQueueCountsDto extends createZodDto(assetQueueCountsSchema) {}

/** A device waiting for acceptance: the list item plus when it was assigned ("waiting since"). */
export const assetPendingItemSchema = assetListItemSchema
  .extend({
    /** `assignedAt` of the open assignment, not the asset's `updatedAt` (reminders and edits move that). */
    assignedAt: isoDateTimeSchema,
  })
  .meta({ id: 'AssetPendingItem' });
export type AssetPendingItemView = z.infer<typeof assetPendingItemSchema>;

const statusCounts = z.object(
  Object.fromEntries(ASSET_STATUSES.map((s) => [s, z.number().int()])) as Record<
    (typeof ASSET_STATUSES)[number],
    z.ZodNumber
  >,
);

export const assetDashboardSchema = z
  .object({
    totals: z.object({ all: z.number().int(), byStatus: statusCounts }),
    byDeviceType: z.array(
      z.object({
        deviceType: z.object({ id: uuidSchema, code: z.string(), name: z.string() }),
        total: z.number().int(),
        inUse: z.number().int(),
        inStock: z.number().int(),
      }),
    ),
    byManufacturer: z.array(z.object({ manufacturer: idName, total: z.number().int() })),
    pendingAcceptance: z.object({
      total: z.number().int(),
      overdue: z.number().int(),
      oldest: z.array(assetPendingItemSchema),
    }),
    recentActivity: z.array(
      z.object({
        ...timelineEntrySchema.shape,
        asset: z.object({ id: uuidSchema, assetTag: z.string(), model: z.string() }),
      }),
    ),
  })
  .meta({ id: 'AssetDashboard' });
export class AssetDashboardDto extends createZodDto(z.object(assetDashboardSchema.shape)) {}
export type AssetDashboardView = z.infer<typeof assetDashboardSchema>;

// --- queries -----------------------------------------------------------------

export const ASSET_SORT_FIELDS = ['assetTag', 'serialNumber', 'status', 'purchaseDate', 'updatedAt', 'model'] as const;

/** Filters shared by `GET /assets` and `GET /assets/export.csv`. */
export const assetFilterSchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: csvOf(z.enum(ASSET_STATUSES)),
  deviceTypeId: csvOf(z.uuid()),
  manufacturerId: csvOf(z.uuid()),
  modelId: csvOf(z.uuid()),
  platformId: csvOf(z.uuid()),
  assignedUserId: csvOf(z.uuid()),
  costCenterId: csvOf(z.uuid()),
  /** purchaseDate range (inclusive) */
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  includeDeleted: booleanQuery.default(false),
  sort: sortParam({ allowed: ASSET_SORT_FIELDS, default: '-updatedAt' }),
});
export type AssetFilter = z.infer<typeof assetFilterSchema>;

export class ListAssetsQuery extends createZodDto(paginationQuerySchema.extend(assetFilterSchema.shape)) {}
export class ExportAssetsQuery extends createZodDto(assetFilterSchema) {}

// --- request bodies ----------------------------------------------------------

const serialSchema = z.string().trim().min(1).max(80);
const optionalDate = isoDateSchema.nullish().transform((v) => v ?? null);

export const createAssetSchema = z.strictObject({
  serialNumber: serialSchema,
  name: optionalTextSchema(120),
  modelId: z.uuid(),
  platformId: z.uuid().nullish(),
  purchaseDate: optionalDate,
  costCenterId: z.uuid().nullish(),
  mdmEnrolled: z.boolean().optional(),
  notes: optionalTextSchema(2000),
  assignToUserId: z.uuid().nullish(),
});
export class CreateAssetDto extends createZodDto(createAssetSchema) {}

export const updateAssetSchema = z.strictObject({
  serialNumber: serialSchema.optional(),
  name: optionalTextSchema(120).optional(),
  modelId: z.uuid().optional(),
  platformId: z.uuid().nullish(),
  purchaseDate: isoDateSchema.nullish(),
  costCenterId: z.uuid().nullish(),
  mdmEnrolled: z.boolean().optional(),
  notes: optionalTextSchema(2000).optional(),
  version: z.number().int().min(1).optional(),
});
export class UpdateAssetDto extends createZodDto(updateAssetSchema) {}

/**
 * Action bodies (API.md §6.3). Notes and optional reasons are copied to `reason` so the
 * workflow engine stores them on the audit row (shown in the timeline).
 */
export const assignBody = z
  .strictObject({ userId: z.uuid(), note: optionalTextSchema(1000) })
  .transform((v) => ({ ...v, reason: v.note }));
export const acceptBody = z.strictObject({
  platformId: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
});
export const declineBody = z.strictObject({ reason: reasonSchema });
export const unassignBody = z.strictObject({ reason: optionalTextSchema(1000) });
export const returnBody = z
  .strictObject({ condition: returnConditionSchema, note: optionalTextSchema(1000) })
  .transform((v) => ({ ...v, reason: v.note }));
export const sendToRepairBody = z
  .strictObject({ note: z.string().trim().min(3).max(1000) })
  .transform((v) => ({ ...v, reason: v.note }));
export const completeRepairBody = z
  .strictObject({ note: optionalTextSchema(1000) })
  .transform((v) => ({ ...v, reason: v.note }));
export const scrapBody = z.strictObject({ reason: reasonSchema });

export type AssignInput = z.output<typeof assignBody>;
export type AcceptInput = z.output<typeof acceptBody>;
export type DeclineInput = z.output<typeof declineBody>;
export type ReturnInput = z.output<typeof returnBody>;
