import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  attachmentDtoSchema,
  attachmentIdsSchema,
  commentSchema,
  isoDateSchema,
  optionalTextSchema,
  reasonSchema,
  timelineEntrySchema,
  uuidSchema,
} from '@/common/domain/schemas';
import { paginatedSchema, paginationQuerySchema } from '@/common/http/pagination';
import { sortParam } from '@/common/http/sort';
import { ATTENDEE_STATUSES, BILLING_STATUSES, LIKERT, MAX_ATTENDEES, RATING_STATES } from '../training.constants';
import {
  participationDetailSchema,
  participationListItemSchema,
  ratingStatsSchema,
  trainingAttendeeSchema,
  trainingCountsSchema,
  trainingFormatSchema,
  trainingPreviewSchema,
  trainingRatingSchema,
  trainingRequestDetailSchema,
  trainingRequestSummarySchema,
} from './training-response.schemas';

// --- Query helpers ------------------------------------------------------------------

/** `?status=a,b` -> ['a', 'b'] validated against `values` (422 on unknown values). */
export function csvEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return z
    .string()
    .trim()
    .optional()
    .transform((raw, ctx) => {
      if (!raw) return undefined;
      const items = raw
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      const isValue = (v: string): v is T[number] => values.includes(v);
      const bad = items.filter((v) => !isValue(v));
      if (bad.length) {
        ctx.addIssue({
          code: 'custom',
          message: `Unknown value(s): ${bad.join(', ')}. Allowed: ${values.join(', ')}.`,
        });
        return z.NEVER;
      }
      return items.filter(isValue);
    });
}

export const booleanQuery = z.enum(['true', 'false']).transform((v) => v === 'true');

const moneyInput = z.strictObject({
  amountCents: z.number().int().min(0).max(100_000_000),
  currency: z.literal('EUR'),
});

const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^https:\/\/[^\s]+$/i.test(v), { message: 'Use a link that starts with https://' });

// --- Bodies ---------------------------------------------------------------------------

export const hotelInputSchema = z.strictObject({
  checkInOn: isoDateSchema,
  checkOutOn: isoDateSchema,
  cost: moneyInput.nullish().transform((v) => v ?? null),
});

export const attendeeInputSchema = z.strictObject({
  userId: uuidSchema,
  costCenterId: uuidSchema.nullish().transform((v) => v ?? null),
  hotel: hotelInputSchema.nullish().transform((v) => v ?? null),
});
export type AttendeeInput = z.infer<typeof attendeeInputSchema>;
export class AttendeeInputDto extends createZodDto(attendeeInputSchema) {}

const requestFields = {
  topic: z.string().trim().min(3).max(200),
  provider: z.string().trim().min(2).max(120),
  format: trainingFormatSchema,
  location: optionalTextSchema(200),
  registrationUrl: httpsUrl,
  registrationDetails: optionalTextSchema(2000),
  startsOn: isoDateSchema,
  endsOn: isoDateSchema,
  cost: moneyInput,
  costCenterId: uuidSchema.nullish().transform((v) => v ?? null),
  executiveApproverId: uuidSchema.nullish().transform((v) => v ?? null),
  certificateExpected: z.boolean(),
  reimbursementAgreement: z.boolean(),
  requesterComment: optionalTextSchema(2000),
};

export const createTrainingRequestSchema = z
  .strictObject({
    ...requestFields,
    attendees: z.array(attendeeInputSchema).min(1, 'Add at least one attendee.').max(MAX_ATTENDEES),
    attachmentIds: attachmentIdsSchema.nullish().transform((v) => v ?? []),
  })
  .superRefine((body, ctx) => {
    const seen = new Set<string>();
    body.attendees.forEach((a, i) => {
      if (seen.has(a.userId)) {
        ctx.addIssue({ code: 'custom', path: ['attendees', i, 'userId'], message: 'This person is already listed.' });
      }
      seen.add(a.userId);
    });
  });
export type CreateTrainingRequest = z.infer<typeof createTrainingRequestSchema>;
export class CreateTrainingRequestDto extends createZodDto(createTrainingRequestSchema) {}

export const updateTrainingRequestSchema = z.strictObject({
  topic: requestFields.topic.optional(),
  provider: requestFields.provider.optional(),
  format: requestFields.format.optional(),
  location: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v || null)),
  registrationUrl: requestFields.registrationUrl.optional(),
  registrationDetails: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v || null)),
  startsOn: isoDateSchema.optional(),
  endsOn: isoDateSchema.optional(),
  cost: moneyInput.optional(),
  costCenterId: uuidSchema.nullish(),
  executiveApproverId: uuidSchema.nullish(),
  certificateExpected: z.boolean().optional(),
  reimbursementAgreement: z.boolean().optional(),
  requesterComment: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v || null)),
  version: z.number().int().min(1).optional(),
});
export type UpdateTrainingRequest = z.infer<typeof updateTrainingRequestSchema>;
export class UpdateTrainingRequestDto extends createZodDto(updateTrainingRequestSchema) {}

export const updateBackOfficeSchema = z.strictObject({
  billingStatus: z.enum(BILLING_STATUSES).optional(),
  actualCost: moneyInput.nullish(),
  backOfficeComment: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v || null)),
  version: z.number().int().min(1).optional(),
});
export type UpdateBackOffice = z.infer<typeof updateBackOfficeSchema>;
export class UpdateBackOfficeDto extends createZodDto(updateBackOfficeSchema) {}

export const linkAttachmentsSchema = z.strictObject({ attachmentIds: attachmentIdsSchema.min(1) });
export class LinkAttachmentsDto extends createZodDto(linkAttachmentsSchema) {}

/** Lenient preview body (SPEC_RESOLUTIONS #15): attendees may be empty. */
export const trainingPreviewRequestSchema = z.strictObject({
  cost: moneyInput.nullish().transform((v) => v ?? null),
  executiveApproverId: uuidSchema.nullish().transform((v) => v ?? null),
  attendees: z
    .array(z.strictObject({ userId: uuidSchema }))
    .max(MAX_ATTENDEES)
    .default([]),
});
export type TrainingPreviewRequest = z.infer<typeof trainingPreviewRequestSchema>;
export class TrainingPreviewRequestDto extends createZodDto(trainingPreviewRequestSchema) {}

export const goalsSchema = z.strictObject({
  goal1: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .transform((v) => v || null),
  goal2: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .transform((v) => v || null),
});
export class GoalsDto extends createZodDto(goalsSchema) {}

// --- Action bodies (POST /training/participations/{id}/actions/{action}) -------------

const optionalComment = commentSchema
  .nullish()
  .transform((v) => (v ? v : null))
  .optional();

export const ACTION_BODIES = {
  approve: z.strictObject({
    comment: commentSchema
      .max(1000)
      .nullish()
      .transform((v) => (v ? v : null)),
  }),
  decline: z.strictObject({ reason: reasonSchema }),
  withdraw: z.strictObject({
    reason: z
      .string()
      .trim()
      .max(1000)
      .nullish()
      .transform((v) => (v ? v : null)),
  }),
  request_cancellation: z.strictObject({ reason: reasonSchema }),
  confirm_cancellation: z.strictObject({ comment: optionalComment }),
  reject_cancellation: z.strictObject({ reason: reasonSchema }),
  book: z.strictObject({
    bookingReference: optionalTextSchema(100),
    comment: optionalComment,
    attachmentIds: attachmentIdsSchema.nullish().transform((v) => v ?? []),
  }),
  mark_booking_impossible: z.strictObject({ reason: reasonSchema }),
  retry_booking: z.strictObject({ comment: optionalComment }),
  close: z.strictObject({ reason: reasonSchema }),
} as const;

// --- Rating submission ----------------------------------------------------------------

const optionalGrade = z
  .number()
  .int()
  .min(1)
  .max(6)
  .nullish()
  .transform((v) => v ?? null);
const optionalLongText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const LOOP_FIELDS = {
  1: ['participated', 'overallGrade', 'trainerGrade', 'expectationsGrade'],
  2: ['appliesLearned', 'supervisorSupported', 'worthwhileForOrganization'],
  3: ['improvementObserved', 'certificationGained', 'certificationComment'],
} as const;

/**
 * `RatingSubmission = Rating1Answers | Rating2Answers | Rating3Answers` (API.md §4.3) as one flat
 * object: `loop` selects the answer set; fields of other loops are rejected; rating 1 needs all
 * three grades when `participated` and none otherwise.
 */
export const ratingSubmissionSchema = z
  .strictObject({
    loop: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    participated: z.boolean().optional(),
    overallGrade: optionalGrade.optional(),
    trainerGrade: optionalGrade.optional(),
    expectationsGrade: optionalGrade.optional(),
    appliesLearned: z.enum(LIKERT).optional(),
    supervisorSupported: z.enum(LIKERT).optional(),
    worthwhileForOrganization: z.enum(LIKERT).optional(),
    improvementObserved: z.number().int().min(1).max(4).optional(),
    certificationGained: z.boolean().optional(),
    certificationComment: optionalLongText(1000).optional(),
    comment: optionalLongText(2000).optional(),
  })
  .superRefine((body, ctx) => {
    const own: readonly string[] = LOOP_FIELDS[body.loop];
    for (const [loop, fields] of Object.entries(LOOP_FIELDS)) {
      if (Number(loop) === body.loop) continue;
      for (const field of fields) {
        if ((body as Record<string, unknown>)[field] !== undefined && !own.includes(field)) {
          ctx.addIssue({ code: 'custom', path: [field], message: `Not part of feedback round ${body.loop}.` });
        }
      }
    }
    const required = (field: string, message: string) => {
      if ((body as Record<string, unknown>)[field] === undefined || (body as Record<string, unknown>)[field] === null)
        ctx.addIssue({ code: 'custom', path: [field], message });
    };
    if (body.loop === 1) {
      required('participated', 'Say whether you took part.');
      for (const field of ['overallGrade', 'trainerGrade', 'expectationsGrade'] as const) {
        const value = body[field] ?? null;
        if (body.participated === true && value === null)
          ctx.addIssue({
            code: 'custom',
            path: [field],
            message: 'Pick a grade from 1 (excellent) to 6 (insufficient).',
          });
        if (body.participated === false && value !== null)
          ctx.addIssue({ code: 'custom', path: [field], message: 'Leave the grades empty if you did not take part.' });
      }
    } else if (body.loop === 2) {
      for (const field of LOOP_FIELDS[2]) required(field, 'Pick one of the four options.');
    } else {
      required('improvementObserved', 'Pick how visible the improvement is.');
      required('certificationGained', 'Say whether a certification was gained.');
    }
  });
export type RatingSubmission = z.infer<typeof ratingSubmissionSchema>;
export class RatingSubmissionDto extends createZodDto(ratingSubmissionSchema) {}

// --- List queries ---------------------------------------------------------------------

export const listRequestsQuerySchema = paginationQuerySchema.extend({
  scope: z.enum(['created', 'all']).default('created'),
  q: z.string().trim().max(200).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  billingStatus: csvEnum(BILLING_STATUSES),
  attendeeStatus: csvEnum(ATTENDEE_STATUSES),
  sort: sortParam({ allowed: ['startsOn', 'createdAt', 'topic', 'cost'], default: '-createdAt' }),
});
export type ListRequestsQuery = z.infer<typeof listRequestsQuerySchema>;
export class ListRequestsQueryDto extends createZodDto(listRequestsQuerySchema) {}

export const PARTICIPATION_SCOPES = ['mine', 'approvals', 'executive', 'deputy', 'team', 'all'] as const;
export type ParticipationScope = (typeof PARTICIPATION_SCOPES)[number];

export const listParticipationsQuerySchema = paginationQuerySchema.extend({
  scope: z.enum(PARTICIPATION_SCOPES).default('mine'),
  status: csvEnum(ATTENDEE_STATUSES),
  q: z.string().trim().max(200).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  requestId: uuidSchema.optional(),
  /** SPEC_RESOLUTIONS #16 */
  highPriority: booleanQuery.optional(),
  /** Default depends on the scope (startsOn for approval scopes, else -createdAt). */
  sort: z.string().trim().optional(),
});
export type ListParticipationsQuery = z.infer<typeof listParticipationsQuerySchema>;
export class ListParticipationsQueryDto extends createZodDto(listParticipationsQuerySchema) {}

export const exportParticipationsQuerySchema = listParticipationsQuerySchema.omit({
  page: true,
  perPage: true,
  scope: true,
});
export class ExportParticipationsQueryDto extends createZodDto(exportParticipationsQuerySchema) {}

export const listRatingsQuerySchema = paginationQuerySchema.extend({
  scope: z.enum(['mine', 'all']).default('mine'),
  state: csvEnum(RATING_STATES),
  loop: csvEnum(['1', '2', '3']),
  q: z.string().trim().max(200).optional(),
  sort: sortParam({ allowed: ['dueAt', 'submittedAt'], default: 'dueAt' }),
});
export type ListRatingsQuery = z.infer<typeof listRatingsQuerySchema>;
export class ListRatingsQueryDto extends createZodDto(listRatingsQuerySchema) {}

export const ratingStatsQuerySchema = z.object({ from: isoDateSchema.optional(), to: isoDateSchema.optional() });
export class RatingStatsQueryDto extends createZodDto(ratingStatsQuerySchema) {}

// --- Response DTO classes -------------------------------------------------------------

export class TrainingRequestDetailDto extends createZodDto(trainingRequestDetailSchema) {}
export class TrainingRequestPageDto extends createZodDto(paginatedSchema(trainingRequestSummarySchema)) {}
export class TrainingAttendeeDto extends createZodDto(trainingAttendeeSchema) {}
export class TrainingParticipationPageDto extends createZodDto(paginatedSchema(participationListItemSchema)) {}
export class TrainingParticipationDetailDto extends createZodDto(participationDetailSchema) {}
export class TrainingRatingDto extends createZodDto(trainingRatingSchema) {}
export class TrainingRatingPageDto extends createZodDto(paginatedSchema(trainingRatingSchema)) {}
export class RatingStatsDto extends createZodDto(ratingStatsSchema) {}
export class TrainingCountsDto extends createZodDto(trainingCountsSchema) {}
export class TrainingPreviewDto extends createZodDto(trainingPreviewSchema) {}
/** Shared shapes have `.meta({ id })`, so wrap their shape (CONVENTIONS §1.4). */
export class TrainingAttachmentDto extends createZodDto(z.object(attachmentDtoSchema.shape)) {}
export class TrainingTimelineEntryDto extends createZodDto(z.object(timelineEntrySchema.shape)) {}
