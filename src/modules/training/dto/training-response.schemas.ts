import { z } from 'zod';
import {
  actingAsSchema,
  approverReasonSchema,
  attachmentDtoSchema,
  autoApprovalSchema,
  decisionSchema,
  isoDateSchema,
  isoDateTimeSchema,
  moneySchema,
  refSchema,
  userRefSchema,
  uuidSchema,
} from '@/common/domain/schemas';
import {
  ATTENDEE_ACTIONS,
  ATTENDEE_STATUSES,
  BILLING_STATUSES,
  LIKERT,
  RATING_STATES,
  REQUEST_ACTIONS,
  TRAINING_FORMATS,
} from '../training.constants';

/** Response building blocks of API.md §4.2 (every field present; empty = null / []). */

export const attendeeStatusSchema = z.enum(ATTENDEE_STATUSES);
export const trainingFormatSchema = z.enum(TRAINING_FORMATS);
export const billingStatusSchema = z.enum(BILLING_STATUSES);
export const ratingStateSchema = z.enum(RATING_STATES);
export const likertSchema = z.enum(LIKERT);
export const ratingLoopSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export const schoolGradeSchema = z.number().int().min(1).max(6);
export const improvementSchema = z.number().int().min(1).max(4);
export const attendeeActionSchema = z.enum(ATTENDEE_ACTIONS);
export const requestActionSchema = z.enum(REQUEST_ACTIONS);

export const trainingRequestSummarySchema = z.object({
  id: uuidSchema,
  reference: z.string(),
  topic: z.string(),
  provider: z.string(),
  format: trainingFormatSchema,
  location: z.string().nullable(),
  startsOn: isoDateSchema,
  endsOn: isoDateSchema,
  cost: moneySchema,
  requester: userRefSchema,
  attendeeCount: z.number().int(),
  statusCounts: z.partialRecord(attendeeStatusSchema, z.number().int()),
  billingStatus: billingStatusSchema,
  /** SPEC_RESOLUTIONS #16: null unless training_office / it_admin. */
  actualCost: moneySchema.nullable(),
  executiveStepRequired: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type TrainingRequestSummaryView = z.infer<typeof trainingRequestSummarySchema>;

export const trainingRatingBriefSchema = z
  .object({
    id: uuidSchema,
    loop: ratingLoopSchema,
    state: ratingStateSchema,
    dueAt: isoDateTimeSchema,
    submittedAt: isoDateTimeSchema.nullable(),
    rater: userRefSchema,
  })
  .meta({ id: 'TrainingRatingBrief' });

export const trainingAttendeeSchema = z.object({
  id: uuidSchema,
  requestId: uuidSchema,
  user: userRefSchema,
  costCenter: refSchema,
  status: attendeeStatusSchema,
  approver: userRefSchema.nullable(),
  approverReason: approverReasonSchema,
  /** The site manager the approval was escalated past (SPEC_RESOLUTIONS #2). */
  escalatedFrom: userRefSchema.nullable(),
  executiveApprover: userRefSchema.nullable(),
  hotel: z.object({ checkInOn: isoDateSchema, checkOutOn: isoDateSchema, cost: moneySchema.nullable() }).nullable(),
  goals: z.object({
    goal1: z.string().nullable(),
    goal2: z.string().nullable(),
    updatedAt: isoDateTimeSchema.nullable(),
  }),
  bookingReference: z.string().nullable(),
  managerDecision: decisionSchema.nullable(),
  executiveDecision: decisionSchema.nullable(),
  declineReason: z.string().nullable(),
  bookingImpossibleReason: z.string().nullable(),
  cancellationReason: z.string().nullable(),
  bookedAt: isoDateTimeSchema.nullable(),
  cancellationRequestedAt: isoDateTimeSchema.nullable(),
  cancelledAt: isoDateTimeSchema.nullable(),
  /** Booking documents (purpose training_booking_document). */
  attachments: z.array(attachmentDtoSchema),
  ratings: z.array(trainingRatingBriefSchema),
  isHighPriority: z.boolean(),
  availableActions: z.array(attendeeActionSchema),
  updatedAt: isoDateTimeSchema,
  version: z.number().int(),
});
export type TrainingAttendeeView = z.infer<typeof trainingAttendeeSchema>;

export const trainingRequestDetailSchema = trainingRequestSummarySchema.extend({
  registrationUrl: z.string().nullable(),
  registrationDetails: z.string().nullable(),
  costCenter: refSchema,
  executiveApprover: userRefSchema.nullable(),
  certificateExpected: z.boolean(),
  reimbursementAgreement: z.boolean(),
  requesterComment: z.string().nullable(),
  backOffice: z
    .object({ comment: z.string().nullable(), billingStatus: billingStatusSchema, actualCost: moneySchema.nullable() })
    .nullable(),
  attachments: z.array(attachmentDtoSchema),
  attendees: z.array(trainingAttendeeSchema),
  availableActions: z.array(requestActionSchema),
  version: z.number().int(),
});
export type TrainingRequestDetailView = z.infer<typeof trainingRequestDetailSchema>;

export const participationListItemSchema = z.object({
  id: uuidSchema,
  status: attendeeStatusSchema,
  user: userRefSchema,
  approver: userRefSchema.nullable(),
  approverReason: approverReasonSchema,
  escalatedFrom: userRefSchema.nullable(),
  executiveApprover: userRefSchema.nullable(),
  /** Viewer's relation in approval scopes: approver | deputy | manager_chain | executive. */
  actingAs: actingAsSchema.nullable(),
  request: z.object({
    id: uuidSchema,
    reference: z.string(),
    topic: z.string(),
    provider: z.string(),
    format: trainingFormatSchema,
    startsOn: isoDateSchema,
    endsOn: isoDateSchema,
    cost: moneySchema,
    executiveStepRequired: z.boolean(),
    requester: userRefSchema,
  }),
  hotelNeeded: z.boolean(),
  isHighPriority: z.boolean(),
  /** SPEC_RESOLUTIONS #14 */
  goalsSet: z.boolean(),
  openRating: z
    .object({
      id: uuidSchema,
      loop: ratingLoopSchema,
      state: ratingStateSchema,
      dueAt: isoDateTimeSchema,
    })
    .nullable(),
  updatedAt: isoDateTimeSchema,
  availableActions: z.array(attendeeActionSchema),
});
export type ParticipationListItemView = z.infer<typeof participationListItemSchema>;

export const participationDetailSchema = trainingAttendeeSchema.extend({
  request: trainingRequestSummarySchema.extend({
    registrationUrl: z.string().nullable(),
    registrationDetails: z.string().nullable(),
    certificateExpected: z.boolean(),
    reimbursementAgreement: z.boolean(),
    requesterComment: z.string().nullable(),
    attachments: z.array(attachmentDtoSchema),
  }),
});
export type ParticipationDetailView = z.infer<typeof participationDetailSchema>;

export const rating1AnswersSchema = z.object({
  loop: z.literal(1),
  participated: z.boolean(),
  overallGrade: schoolGradeSchema.nullable(),
  trainerGrade: schoolGradeSchema.nullable(),
  expectationsGrade: schoolGradeSchema.nullable(),
  comment: z.string().nullable(),
});
export const rating2AnswersSchema = z.object({
  loop: z.literal(2),
  appliesLearned: likertSchema,
  supervisorSupported: likertSchema,
  worthwhileForOrganization: likertSchema,
  comment: z.string().nullable(),
});
export const rating3AnswersSchema = z.object({
  loop: z.literal(3),
  improvementObserved: improvementSchema,
  certificationGained: z.boolean(),
  certificationComment: z.string().nullable(),
  comment: z.string().nullable(),
});

export const trainingRatingSchema = z.object({
  id: uuidSchema,
  loop: ratingLoopSchema,
  state: ratingStateSchema,
  rater: userRefSchema,
  attendee: z.object({ id: uuidSchema, user: userRefSchema }),
  training: z.object({
    requestId: uuidSchema,
    reference: z.string(),
    topic: z.string(),
    provider: z.string(),
    startsOn: isoDateSchema,
    endsOn: isoDateSchema,
  }),
  dueAt: isoDateTimeSchema,
  submittedAt: isoDateTimeSchema.nullable(),
  reminderCount: z.number().int(),
  lastRemindedAt: isoDateTimeSchema.nullable(),
  answers: z.union([rating1AnswersSchema, rating2AnswersSchema, rating3AnswersSchema]).nullable(),
  availableActions: z.array(z.literal('submit')),
});
export type TrainingRatingView = z.infer<typeof trainingRatingSchema>;

const likertDistribution = z.object({
  A: z.number().int(),
  B: z.number().int(),
  C: z.number().int(),
  D: z.number().int(),
});

export const ratingStatsSchema = z.object({
  from: isoDateSchema.nullable(),
  to: isoDateSchema.nullable(),
  loop1: z.object({
    submitted: z.number().int(),
    participatedRate: z.number(),
    avgOverall: z.number().nullable(),
    avgTrainer: z.number().nullable(),
    avgExpectations: z.number().nullable(),
  }),
  loop2: z.object({
    submitted: z.number().int(),
    distribution: z.object({
      appliesLearned: likertDistribution,
      supervisorSupported: likertDistribution,
      worthwhileForOrganization: likertDistribution,
    }),
  }),
  loop3: z.object({
    submitted: z.number().int(),
    distribution: z.object({ 1: z.number().int(), 2: z.number().int(), 3: z.number().int(), 4: z.number().int() }),
    certificationRate: z.number().nullable(),
  }),
  open: z.object({ due: z.number().int(), overdue: z.number().int(), maxedOut: z.number().int() }),
});
export type RatingStatsView = z.infer<typeof ratingStatsSchema>;

export const trainingCountsSchema = z.object({
  mine: z.object({ active: z.number().int(), ratingsDue: z.number().int(), goalsMissing: z.number().int() }),
  approvals: z.object({
    manager: z.number().int(),
    executive: z.number().int(),
    deputy: z.number().int(),
    team: z.number().int(),
  }),
  office: z
    .object({
      toBook: z.number().int(),
      cancellationRequested: z.number().int(),
      pendingApproval: z.number().int(),
      bookingImpossible: z.number().int(),
      ratingsOverdue: z.number().int(),
      billingOpen: z.number().int(),
    })
    .nullable(),
});
export type TrainingCountsView = z.infer<typeof trainingCountsSchema>;

export const trainingPreviewSchema = z.object({
  executiveStepRequired: z.boolean(),
  threshold: moneySchema,
  executiveCandidates: z.array(userRefSchema),
  /** Echo of the chosen executive approver (SPEC_RESOLUTIONS #15), null below the threshold. */
  executiveApprover: userRefSchema.nullable(),
  attendees: z.array(
    z.object({
      user: userRefSchema,
      approver: userRefSchema.nullable(),
      approverReason: approverReasonSchema,
      escalatedFrom: userRefSchema.nullable(),
      autoApproval: autoApprovalSchema.nullable(),
      activeDeputies: z.array(userRefSchema),
      allowed: z.boolean(),
      notAllowedReason: z.string().nullable(),
      /** SPEC_RESOLUTIONS #15: the state the participation would start in. */
      initialState: attendeeStatusSchema,
      executiveAutoApproval: autoApprovalSchema.nullable(),
    }),
  ),
});
export type TrainingPreviewView = z.infer<typeof trainingPreviewSchema>;
