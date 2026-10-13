import type { Prisma } from '@/generated/prisma/client';

/** Prisma includes shared by the training services (one place, so DTO mappers stay typed). */

export const requestCoreInclude = {
  requester: true,
  costCenter: true,
  executiveApprover: true,
  attendees: { select: { id: true, status: true } },
} satisfies Prisma.TrainingRequestInclude;

export type RequestCoreRow = Prisma.TrainingRequestGetPayload<{ include: typeof requestCoreInclude }>;

export const attendeeInclude = {
  request: { include: requestCoreInclude },
  user: true,
  costCenter: true,
  approver: true,
  escalatedFrom: true,
  executiveApprover: true,
  managerDecisionBy: true,
  executiveDecisionBy: true,
  ratings: { include: { rater: true }, orderBy: { loop: 'asc' } },
} satisfies Prisma.TrainingAttendeeInclude;

export type AttendeeRow = Prisma.TrainingAttendeeGetPayload<{ include: typeof attendeeInclude }>;

export const ratingInclude = {
  rater: true,
  attendee: { include: { user: true, request: true } },
} satisfies Prisma.TrainingRatingInclude;

export type RatingRow = Prisma.TrainingRatingGetPayload<{ include: typeof ratingInclude }>;
