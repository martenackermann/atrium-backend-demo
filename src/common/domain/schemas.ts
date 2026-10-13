import { z } from 'zod';
import {
  ACTING_AS,
  APPROVER_REASONS,
  ATTACHMENT_PURPOSES,
  AUTO_APPROVALS,
  MODULE_NAMES,
  NOTIFICATION_PRIORITIES,
  PERSONA_KEYS,
  ROLE_NAMES,
  ASSIGNABLE_ROLES,
  TONES,
} from './vocabulary';

/**
 * Shared DTO building blocks (API.md §2.1). Every module builds its response schemas
 * from these so the OpenAPI document has one definition per shared type.
 * Response fields are always present: use `.nullable()`, never `.optional()`.
 */

export const uuidSchema = z.uuid();
/** 'YYYY-MM-DD' (calendar date in APP_TIMEZONE). */
export const isoDateSchema = z.iso.date();
/** 'YYYY-MM-DDTHH:mm:ss.sssZ' (UTC). */
export const isoDateTimeSchema = z.iso.datetime();

export const roleNameSchema = z.enum(ROLE_NAMES);
export const assignableRoleSchema = z.enum(ASSIGNABLE_ROLES);
export const personaKeySchema = z.enum(PERSONA_KEYS);
export const moduleNameSchema = z.enum(MODULE_NAMES);
export const actingAsSchema = z.enum(ACTING_AS);
export const approverReasonSchema = z.enum(APPROVER_REASONS);
export const autoApprovalSchema = z.enum(AUTO_APPROVALS);
export const attachmentPurposeSchema = z.enum(ATTACHMENT_PURPOSES);
export const toneSchema = z.enum(TONES);
export const notificationPrioritySchema = z.enum(NOTIFICATION_PRIORITIES);

export const moneySchema = z
  .object({ amountCents: z.number().int().min(0), currency: z.literal('EUR') })
  .meta({ id: 'Money' });

/** Department, site or cost centre reference. */
export const refSchema = z.object({ id: uuidSchema, code: z.string(), name: z.string() }).meta({ id: 'Ref' });

export const userRefSchema = z
  .object({
    id: uuidSchema,
    displayName: z.string(),
    email: z.string(),
    jobTitle: z.string().nullable(),
    initials: z.string(),
  })
  .meta({ id: 'UserRef' });

export const userSummarySchema = userRefSchema
  .extend({ department: refSchema.nullable(), site: refSchema.nullable(), active: z.boolean() })
  .meta({ id: 'UserSummary' });

export const attachmentDtoSchema = z
  .object({
    id: uuidSchema,
    originalName: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number().int(),
    purpose: attachmentPurposeSchema,
    uploadedBy: userRefSchema,
    createdAt: isoDateTimeSchema,
  })
  .meta({ id: 'AttachmentDto' });

export const signedImageSchema = z
  .object({ attachmentId: uuidSchema, url: z.string(), expiresAt: isoDateTimeSchema })
  .meta({ id: 'SignedImage' });

export const fieldChangeSchema = z
  .object({ field: z.string(), label: z.string(), from: z.unknown(), to: z.unknown() })
  .meta({ id: 'FieldChange' });

export const timelineEntrySchema = z
  .object({
    id: uuidSchema,
    occurredAt: isoDateTimeSchema,
    actor: userRefSchema.nullable(),
    actingAs: actingAsSchema,
    entityType: z.string(),
    entityId: uuidSchema,
    entityLabel: z.string(),
    action: z.string(),
    fromState: z.string().nullable(),
    toState: z.string().nullable(),
    reason: z.string().nullable(),
    changes: z.array(fieldChangeSchema).nullable(),
    summary: z.string(),
  })
  .meta({ id: 'TimelineEntry' });

export const approverCandidateSchema = z
  .object({
    user: userRefSchema,
    level: z.number().int(),
    isSiteManager: z.boolean(),
    isDefault: z.boolean(),
    selectable: z.boolean(),
    reason: approverReasonSchema.nullable(),
  })
  .meta({ id: 'ApproverCandidate' });

export const decisionSchema = z
  .object({
    at: isoDateTimeSchema,
    by: userRefSchema.nullable(),
    actingAs: actingAsSchema,
    autoApproval: autoApprovalSchema.nullable(),
    comment: z.string().nullable(),
  })
  .meta({ id: 'Decision' });

/**
 * Postal address (API.md §2.1). Persist it as flat columns with a common prefix, e.g.
 * `deliveryStreet`, `deliveryHouseNumber`, `deliveryPostalCode`, `deliveryCity`,
 * `deliveryCountryCode` (snake_case columns via @map) - SPEC_RESOLUTIONS #1.
 */
export const addressSchema = z
  .strictObject({
    street: z.string().trim().min(1).max(120),
    houseNumber: z.string().trim().min(1).max(20),
    postalCode: z.string().trim().min(2).max(12),
    city: z.string().trim().min(1).max(80),
    countryCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, 'Use an ISO 3166-1 alpha-2 code'),
  })
  .meta({ id: 'Address' });
export type Address = z.infer<typeof addressSchema>;

/** Request-side helpers (API.md §1/§2.3). */
export const reasonSchema = z.string().trim().min(3).max(1000);
export const commentSchema = z.string().trim().max(2000);
/** Optional text: "" becomes null. */
export const optionalTextSchema = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));
export const attachmentIdsSchema = z.array(uuidSchema).max(10);
