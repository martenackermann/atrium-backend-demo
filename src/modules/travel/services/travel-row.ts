import type { Prisma } from '@/generated/prisma/client';

/** Everything the detail DTO needs. */
export const travelDetailInclude = {
  traveller: true,
  requester: true,
  approver: true,
  escalatedFrom: true,
  approvedBy: true,
  declinedBy: true,
  costCenter: true,
  car: { include: { carClass: true } },
  train: true,
  flight: true,
  companions: { include: { user: true }, orderBy: { position: 'asc' } },
  booking: { include: { bookedBy: true } },
} satisfies Prisma.TravelRequestInclude;

export type TravelRow = Prisma.TravelRequestGetPayload<{ include: typeof travelDetailInclude }>;

/** Lists: people + companions (visibility) + booking (PIN capability). */
export const travelSummaryInclude = {
  traveller: true,
  requester: true,
  approver: true,
  companions: { select: { userId: true } },
  booking: { select: { pinEncrypted: true, bookingNumber: true } },
} satisfies Prisma.TravelRequestInclude;

export type TravelSummaryRow = Prisma.TravelRequestGetPayload<{ include: typeof travelSummaryInclude }>;
