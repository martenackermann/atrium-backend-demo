import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  addressSchema,
  attachmentDtoSchema,
  attachmentIdsSchema,
  isoDateSchema,
  isoDateTimeSchema,
  optionalTextSchema,
  reasonSchema,
  refSchema,
  userRefSchema,
  uuidSchema,
} from '@/common/domain/schemas';
import { paginatedSchema, paginationQuerySchema } from '@/common/http/pagination';
import { sortParam } from '@/common/http/sort';
import {
  OPEN_STATUSES,
  PEOPLE_ACTIONS,
  PEOPLE_COMMENT_KINDS,
  PEOPLE_REQUEST_STATUSES,
  PEOPLE_REQUEST_TYPES,
  PRIORITIES,
  SALUTATIONS,
} from '../people.constants';

export const peopleRequestTypeSchema = z.enum(PEOPLE_REQUEST_TYPES);
export const peopleRequestStatusSchema = z.enum(PEOPLE_REQUEST_STATUSES);
export const prioritySchema = z.enum(PRIORITIES);
export const salutationSchema = z.enum(SALUTATIONS);
export const peopleActionSchema = z.enum(PEOPLE_ACTIONS);

/** Comma-separated enum list in a query string (`?status=open,reopened`). */
function csvEnum<T extends readonly [string, ...string[]]>(values: T) {
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
    .pipe(z.array(z.enum(values)));
}

// --- Responses ------------------------------------------------------------------

export const jobRoleRefSchema = z.object({ id: uuidSchema, name: z.string() });

export const peopleRequestSummarySchema = z.object({
  id: uuidSchema,
  reference: z.string(),
  type: peopleRequestTypeSchema,
  title: z.string(),
  priority: prioritySchema,
  status: peopleRequestStatusSchema,
  subjectName: z.string(),
  subjectUser: userRefSchema.nullable(),
  effectiveDate: isoDateSchema,
  jobRole: jobRoleRefSchema.nullable(),
  requester: userRefSchema,
  manager: userRefSchema.nullable(),
  assignee: userRefSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  availableActions: z.array(peopleActionSchema),
});
export type PeopleRequestSummaryView = z.infer<typeof peopleRequestSummarySchema>;

export const personalDataSchema = z.object({
  birthDate: isoDateSchema.nullable(),
  placeOfBirth: z.string().nullable(),
  nationality: z.string().nullable(),
  privateAddress: z.object(addressSchema.shape).nullable(),
  privatePhone: z.string().nullable(),
  privateEmail: z.string().nullable(),
});
export type PersonalDataView = z.infer<typeof personalDataSchema>;

export const peopleCommentSchema = z.object({
  id: uuidSchema,
  author: userRefSchema,
  body: z.string(),
  internal: z.boolean(),
  /** SPEC_RESOLUTIONS #19. */
  kind: z.enum(PEOPLE_COMMENT_KINDS),
  createdAt: isoDateTimeSchema,
});
export type PeopleCommentView = z.infer<typeof peopleCommentSchema>;

export const peopleRequestDetailSchema = peopleRequestSummarySchema.extend({
  salutation: salutationSchema.nullable(),
  firstName: z.string(),
  lastName: z.string(),
  department: refSchema.nullable(),
  site: refSchema.nullable(),
  managerDeputy: userRefSchema.nullable(),
  reason: z.string().nullable(),
  furtherInformation: z.string().nullable(),
  equipmentNotes: z.string().nullable(),
  personalData: personalDataSchema.nullable(),
  personalDataRedacted: z.boolean(),
  internalNote: z.string().nullable(),
  attachments: z.array(attachmentDtoSchema),
  /** The question People Ops is waiting on (status waiting_on_requester), SPEC_RESOLUTIONS #19. */
  openQuestion: peopleCommentSchema.nullable(),
  statusReason: z.string().nullable(),
  closedAt: isoDateTimeSchema.nullable(),
  version: z.number().int(),
});
export type PeopleRequestDetailView = z.infer<typeof peopleRequestDetailSchema>;

export class PeopleRequestDetailDto extends createZodDto(peopleRequestDetailSchema) {}
export class PeopleRequestPageDto extends createZodDto(paginatedSchema(peopleRequestSummarySchema)) {}
export class PeopleCommentDto extends createZodDto(peopleCommentSchema) {}
export class PeopleCommentListDto extends createZodDto(z.array(peopleCommentSchema)) {}

export const peopleQueueCountsSchema = z.object({
  mine: z.object({ open: z.number().int(), waitingOnMe: z.number().int() }),
  ops: z
    .object({
      open: z.number().int(),
      reopened: z.number().int(),
      inProgress: z.number().int(),
      waiting: z.number().int(),
      unassigned: z.number().int(),
      critical: z.number().int(),
    })
    .nullable(),
});
export class PeopleQueueCountsDto extends createZodDto(peopleQueueCountsSchema) {}

// --- Requests -------------------------------------------------------------------

const nullableUuid = uuidSchema.nullish();

export const personalDataInputSchema = z.strictObject({
  birthDate: isoDateSchema.nullish(),
  placeOfBirth: optionalTextSchema(120).optional(),
  nationality: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'Use an ISO 3166-1 alpha-2 code, like DE.')
    .nullish(),
  privateAddress: addressSchema.nullish(),
  privatePhone: optionalTextSchema(40).optional(),
  privateEmail: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => (v ? v : null))
    .pipe(z.email('Enter a valid email address.').nullable())
    .optional(),
});
export type PersonalDataInput = z.infer<typeof personalDataInputSchema>;

const createFields = {
  title: z.string().trim().min(3).max(140),
  priority: prioritySchema.optional(),
  jobRoleId: nullableUuid,
  subjectUserId: nullableUuid,
  salutation: salutationSchema.nullish(),
  firstName: optionalTextSchema(100),
  lastName: optionalTextSchema(100),
  effectiveDate: isoDateSchema,
  departmentId: nullableUuid,
  siteId: nullableUuid,
  managerId: nullableUuid,
  managerDeputyId: nullableUuid,
  reason: optionalTextSchema(2000),
  furtherInformation: optionalTextSchema(2000),
  equipmentNotes: optionalTextSchema(2000),
  personalData: personalDataInputSchema.nullish(),
};

export const createPeopleRequestSchema = z.strictObject({
  type: peopleRequestTypeSchema,
  ...createFields,
  attachmentIds: attachmentIdsSchema.optional(),
});
export type CreatePeopleRequestInput = z.infer<typeof createPeopleRequestSchema>;
export class CreatePeopleRequestDto extends createZodDto(createPeopleRequestSchema) {}

/** Fields the requester may change while `open` (SPEC_RESOLUTIONS #24). */
export const REQUESTER_FIELDS = Object.keys(createFields) as (keyof typeof createFields)[];
/** Fields only people_ops / it_admin may change. */
export const INTERNAL_FIELDS = ['assigneeId', 'internalNote'] as const;

export const updatePeopleRequestSchema = z.strictObject({
  title: createFields.title.optional(),
  priority: prioritySchema.optional(),
  jobRoleId: nullableUuid,
  subjectUserId: nullableUuid,
  salutation: salutationSchema.nullish(),
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  effectiveDate: isoDateSchema.optional(),
  departmentId: nullableUuid,
  siteId: nullableUuid,
  managerId: nullableUuid,
  managerDeputyId: nullableUuid,
  reason: optionalTextSchema(2000).optional(),
  furtherInformation: optionalTextSchema(2000).optional(),
  equipmentNotes: optionalTextSchema(2000).optional(),
  personalData: personalDataInputSchema.nullish(),
  assigneeId: nullableUuid,
  internalNote: optionalTextSchema(4000).optional(),
  version: z.number().int().min(1).optional(),
});
export type UpdatePeopleRequestInput = z.infer<typeof updatePeopleRequestSchema>;
export class UpdatePeopleRequestDto extends createZodDto(updatePeopleRequestSchema) {}

export const createCommentSchema = z.strictObject({
  body: z.string().trim().min(1).max(4000),
  internal: z.boolean().optional(),
});
export class CreatePeopleCommentDto extends createZodDto(createCommentSchema) {}

/** Action bodies (API.md §7.1). */
export const optionalNoteBody = z.strictObject({ note: optionalTextSchema(2000) });
export const requiredNoteBody = z.strictObject({ note: z.string().trim().min(3).max(2000) });
export const questionBody = z.strictObject({ question: z.string().trim().min(3).max(2000) });
export const reasonBody = z.strictObject({ reason: reasonSchema });
export const replyBody = z.strictObject({ body: z.string().trim().min(1).max(4000) });

export const listPeopleRequestsQuerySchema = paginationQuerySchema.extend({
  scope: z.enum(['mine', 'all']).default('mine'),
  status: csvEnum(PEOPLE_REQUEST_STATUSES),
  type: csvEnum(PEOPLE_REQUEST_TYPES),
  priority: csvEnum(PRIORITIES),
  assigneeId: z.union([z.literal('me'), z.literal('none'), uuidSchema]).optional(),
  q: z.string().trim().max(100).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  sort: sortParam({ allowed: ['effectiveDate', 'createdAt', 'priority', 'status'], default: '-createdAt' }),
});
export type ListPeopleRequestsQueryInput = z.infer<typeof listPeopleRequestsQuerySchema>;
export class ListPeopleRequestsQuery extends createZodDto(listPeopleRequestsQuerySchema) {}

export { OPEN_STATUSES };
