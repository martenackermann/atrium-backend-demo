import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  actingAsSchema,
  addressSchema,
  approverCandidateSchema,
  approverReasonSchema,
  attachmentDtoSchema,
  autoApprovalSchema,
  decisionSchema,
  isoDateSchema,
  isoDateTimeSchema,
  optionalTextSchema,
  refSchema,
  timelineEntrySchema,
  userRefSchema,
} from '@/common/domain/schemas';
import { paginatedSchema, paginationQuerySchema } from '@/common/http/pagination';
import {
  APPROVAL_EXEMPTIONS,
  APPROVAL_REASON_CODES,
  DROP_OFF_MODES,
  FARE_TYPES,
  HANDOVER_MODES,
  TRAVEL_ACTIONS,
  TRAVEL_KINDS,
  TRAVEL_STATUSES,
  TRIP_TYPES,
  VEHICLE_TYPES,
} from '../travel.constants';

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

export const travelKindSchema = z.enum(TRAVEL_KINDS);
export const travelStatusSchema = z.enum(TRAVEL_STATUSES);
export const travelActionSchema = z.enum(TRAVEL_ACTIONS);
export const vehicleTypeSchema = z.enum(VEHICLE_TYPES);
export const tripTypeSchema = z.enum(TRIP_TYPES);
export const fareTypeSchema = z.enum(FARE_TYPES);

/** Comma-separated query list validated against an enum (`?status=to_book,booked`). */
export const csvQuery = <T extends readonly [string, ...string[]]>(values: T) =>
  z
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

const booleanQuery = z.enum(['true', 'false']).transform((v) => v === 'true');

export const reasonDtoSchema = z
  .object({ code: z.enum(APPROVAL_REASON_CODES), label: z.string() })
  .meta({ id: 'TravelReasonDto' });
export const exemptionDtoSchema = z
  .object({ code: z.enum(APPROVAL_EXEMPTIONS), label: z.string() })
  .meta({ id: 'TravelExemptionDto' });

// ---------------------------------------------------------------------------
// Responses (API.md §5.2)
// ---------------------------------------------------------------------------

export const travelRequestSummarySchema = z
  .object({
    id: z.uuid(),
    reference: z.string(),
    kind: travelKindSchema,
    status: travelStatusSchema,
    traveller: userRefSchema,
    requester: userRefSchema,
    approver: userRefSchema.nullable(),
    approverReason: approverReasonSchema.nullable(),
    startsAt: isoDateTimeSchema,
    endsAt: isoDateTimeSchema.nullable(),
    route: z.string(),
    needsApproval: z.boolean(),
    approvalReasons: z.array(reasonDtoSchema),
    approvalExemption: exemptionDtoSchema.nullable(),
    isHighPriority: z.boolean(),
    /** Viewer's approval relation when they may decide the pending step. */
    actingAs: actingAsSchema.nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    availableActions: z.array(travelActionSchema),
  })
  .meta({ id: 'TravelRequestSummary' });

const carEquipmentShape = {
  estate: z.boolean(),
  navigation: z.boolean(),
  automaticPreferred: z.boolean(),
  automaticRequired: z.boolean(),
  diesel: z.boolean(),
  winterTyres: z.boolean(),
  foreignTravel: z.boolean(),
  childSeat: z.boolean(),
};

export const carDetailDtoSchema = z
  .object({
    vehicleType: vehicleTypeSchema,
    carClass: z.object({ id: z.uuid(), code: z.string(), name: z.string(), isDefault: z.boolean() }),
    pickupAt: isoDateTimeSchema,
    returnAt: isoDateTimeSchema,
    /** SPEC_RESOLUTIONS #9. */
    destination: z.string(),
    equipment: z.object(carEquipmentShape),
    foreignCountries: z.array(z.string()),
    expectedKmPerDay: z.number().int().nullable(),
    minPayloadKg: z.number().int().nullable(),
    handover: z.object({
      mode: z.enum(HANDOVER_MODES),
      branch: z.string().nullable(),
      address: addressSchema.nullable(),
    }),
    dropOff: z.object({
      mode: z.enum(DROP_OFF_MODES),
      branch: z.string().nullable(),
      address: addressSchema.nullable(),
    }),
    /** null when the viewer may not see driver personal data (SPEC §3.2). */
    driver: z
      .object({
        firstName: z.string(),
        lastName: z.string(),
        email: z.string(),
        phone: z.string(),
        birthDate: isoDateSchema,
        licenceNumber: z.string().nullable(),
        additionalDrivers: z.string().nullable(),
      })
      .nullable(),
    specialEquipmentReason: z.string().nullable(),
  })
  .meta({ id: 'CarDetailDto' });

export const trainDetailDtoSchema = z
  .object({
    tripType: tripTypeSchema,
    outboundAt: isoDateTimeSchema,
    returnAt: isoDateTimeSchema.nullable(),
    fromStation: z.string(),
    viaStation: z.string().nullable(),
    toStation: z.string(),
    fareType: fareTypeSchema,
    seatReservations: z.number().int(),
    separateTickets: z.boolean(),
    localTransportTicket: z.boolean(),
    companions: z.array(userRefSchema),
    notes: z.string().nullable(),
  })
  .meta({ id: 'TrainDetailDto' });

export const flightDetailDtoSchema = z
  .object({
    tripType: tripTypeSchema,
    outboundDepartureAt: isoDateTimeSchema,
    outboundFrom: z.string(),
    outboundTo: z.string(),
    returnDepartureAt: isoDateTimeSchema.nullable(),
    returnFrom: z.string().nullable(),
    returnTo: z.string().nullable(),
    handLuggageOnly: z.boolean(),
    notes: z.string().nullable(),
  })
  .meta({ id: 'FlightDetailDto' });

export const travelBookingDtoSchema = z
  .object({
    bookingNumber: z.string(),
    pinAvailable: z.boolean(),
    comment: z.string().nullable(),
    bookedBy: userRefSchema,
    bookedAt: isoDateTimeSchema,
    attachments: z.array(attachmentDtoSchema),
  })
  .meta({ id: 'TravelBookingDto' });

export const travelRequestDetailSchema = travelRequestSummarySchema.extend({
  escalatedFrom: userRefSchema.nullable(),
  approverSelection: z.enum(['auto', 'manual']).nullable(),
  costCenter: refSchema,
  costCenterReason: z.string().nullable(),
  recharge: z.object({ customer: z.string(), projectNumber: z.string() }).nullable(),
  comment: z.string().nullable(),
  car: carDetailDtoSchema.nullable(),
  train: trainDetailDtoSchema.nullable(),
  flight: flightDetailDtoSchema.nullable(),
  /** Decision of the approval step (approve, auto-approval or decline). */
  approval: decisionSchema.nullable(),
  declinedAt: isoDateTimeSchema.nullable(),
  declineReason: z.string().nullable(),
  bookingImpossibleReason: z.string().nullable(),
  cancellationRequestedAt: isoDateTimeSchema.nullable(),
  cancellationReason: z.string().nullable(),
  cancelledAt: isoDateTimeSchema.nullable(),
  booking: travelBookingDtoSchema.nullable(),
  version: z.number().int(),
});

export class TravelRequestDetailDto extends createZodDto(travelRequestDetailSchema) {}
export class TravelRequestPageDto extends createZodDto(paginatedSchema(travelRequestSummarySchema)) {}
export class TravelTimelineDto extends createZodDto(z.array(timelineEntrySchema)) {}
export class TravelPinDto extends createZodDto(z.object({ pin: z.string() })) {}

export const travelCountsSchema = z.object({
  mine: z.object({ active: z.number().int() }),
  approvals: z.object({ mine: z.number().int(), deputy: z.number().int(), team: z.number().int() }),
  desk: z
    .object({
      pendingApproval: z.number().int(),
      toBook: z.number().int(),
      toBookHighPriority: z.number().int(),
      cancellationRequested: z.number().int(),
      bookingImpossible: z.number().int(),
    })
    .nullable(),
});
export class TravelCountsDto extends createZodDto(travelCountsSchema) {}

// ---------------------------------------------------------------------------
// List / export queries
// ---------------------------------------------------------------------------

export const TRAVEL_SCOPES = ['mine', 'approvals', 'deputy', 'team', 'all'] as const;
export type TravelScope = (typeof TRAVEL_SCOPES)[number];
export const TRAVEL_SORT_FIELDS = ['startsAt', 'createdAt', 'status'] as const;

const listFilterShape = {
  kind: csvQuery(TRAVEL_KINDS),
  status: csvQuery(TRAVEL_STATUSES),
  q: z.string().trim().max(100).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  highPriority: booleanQuery.optional(),
  /** `startsAt`, `createdAt`, `status` (prefix `-` = descending). Default depends on scope. */
  sort: z.string().optional(),
};

export const listTravelQuerySchema = paginationQuerySchema.extend({
  scope: z.enum(TRAVEL_SCOPES).default('mine'),
  ...listFilterShape,
});
export class ListTravelQuery extends createZodDto(listTravelQuerySchema) {}
export type ListTravelQueryInput = z.infer<typeof listTravelQuerySchema>;

export const exportTravelQuerySchema = z.object(listFilterShape);
export class ExportTravelQuery extends createZodDto(exportTravelQuerySchema) {}

// ---------------------------------------------------------------------------
// Create body (API.md §5.3 + SPEC_RESOLUTIONS #9 destination)
// ---------------------------------------------------------------------------

const requiredText = (max: number) => z.string().trim().min(1).max(max);
const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'Use an ISO 3166-1 alpha-2 code');
const nullableAddress = addressSchema.nullish().transform((v) => v ?? null);
const nullableInt = (min: number, max: number) =>
  z
    .number()
    .int()
    .min(min)
    .max(max)
    .nullish()
    .transform((v) => v ?? null);

export const carEquipmentInputSchema = z.strictObject(carEquipmentShape);

export const carInputSchema = z.strictObject({
  vehicleType: vehicleTypeSchema,
  carClassId: z.uuid(),
  pickupAt: isoDateTimeSchema,
  returnAt: isoDateTimeSchema,
  destination: requiredText(120),
  equipment: carEquipmentInputSchema,
  foreignCountries: z.array(countryCodeSchema).max(20).optional().default([]),
  expectedKmPerDay: nullableInt(0, 5000),
  minPayloadKg: nullableInt(0, 20000),
  handover: z.strictObject({ mode: z.enum(HANDOVER_MODES), branch: optionalTextSchema(120), address: nullableAddress }),
  dropOff: z.strictObject({ mode: z.enum(DROP_OFF_MODES), branch: optionalTextSchema(120), address: nullableAddress }),
  driver: z.strictObject({
    firstName: requiredText(80),
    lastName: requiredText(80),
    email: z.email().max(200),
    phone: z.string().trim().min(3).max(40),
    birthDate: isoDateSchema,
    licenceNumber: optionalTextSchema(40),
    additionalDrivers: optionalTextSchema(500),
  }),
  specialEquipmentReason: optionalTextSchema(1000),
});
export type CarInput = z.infer<typeof carInputSchema>;

export const trainInputSchema = z.strictObject({
  tripType: tripTypeSchema,
  outboundAt: isoDateTimeSchema,
  returnAt: isoDateTimeSchema.nullish().transform((v) => v ?? null),
  fromStation: requiredText(120),
  viaStation: optionalTextSchema(120),
  toStation: requiredText(120),
  fareType: fareTypeSchema,
  seatReservations: z.number().int().min(0).max(6),
  separateTickets: z.boolean(),
  localTransportTicket: z.boolean(),
  companionIds: z.array(z.uuid()).max(5).optional().default([]),
  notes: optionalTextSchema(2000),
});
export type TrainInput = z.infer<typeof trainInputSchema>;

export const flightInputSchema = z.strictObject({
  tripType: tripTypeSchema,
  outboundDepartureAt: isoDateTimeSchema,
  outboundFrom: requiredText(120),
  outboundTo: requiredText(120),
  returnDepartureAt: isoDateTimeSchema.nullish().transform((v) => v ?? null),
  returnFrom: optionalTextSchema(120),
  returnTo: optionalTextSchema(120),
  handLuggageOnly: z.boolean(),
  notes: optionalTextSchema(2000),
});
export type FlightInput = z.infer<typeof flightInputSchema>;

const rechargeSchema = z.strictObject({ customer: requiredText(120), projectNumber: requiredText(120) });

const createBaseShape = {
  travellerId: z.uuid(),
  /** Override: a selectable candidate of GET /users/{travellerId}/approvers. */
  approverId: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  costCenterId: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  costCenterReason: optionalTextSchema(500),
  recharge: rechargeSchema.nullish().transform((v) => v ?? null),
  comment: optionalTextSchema(2000),
};

export const createTravelRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('car'), ...createBaseShape, car: carInputSchema }),
  z.strictObject({ kind: z.literal('train'), ...createBaseShape, train: trainInputSchema }),
  z.strictObject({ kind: z.literal('flight'), ...createBaseShape, flight: flightInputSchema }),
]);
/** A union cannot be a class: validate with `@Body(new AppValidationPipe(CreateTravelRequestDto))`. */
export const CreateTravelRequestDto = createZodDto(createTravelRequestSchema);
export type CreateTravelRequestInput = z.infer<typeof createTravelRequestSchema>;

// ---------------------------------------------------------------------------
// Preview (SPEC_RESOLUTIONS #3): only kind + travellerId are mandatory; every other
// field is optional, nullable and lenient (invalid values are ignored, never 422).
// ---------------------------------------------------------------------------

const lenient = <T extends z.ZodType>(schema: T) => schema.nullish().catch(null);
const lenientText = lenient(z.string());
const lenientBool = lenient(z.boolean());
const lenientDateTime = lenient(isoDateTimeSchema);
const lenientUuid = lenient(z.uuid());
const lenientInt = lenient(z.number().int());

const previewAddress = lenient(
  z.object({
    street: lenientText,
    houseNumber: lenientText,
    postalCode: lenientText,
    city: lenientText,
    countryCode: lenientText,
  }),
);

const previewCarSchema = z.object({
  vehicleType: lenient(vehicleTypeSchema),
  carClassId: lenientUuid,
  pickupAt: lenientDateTime,
  returnAt: lenientDateTime,
  destination: lenientText,
  equipment: lenient(
    z.object({
      estate: lenientBool,
      navigation: lenientBool,
      automaticPreferred: lenientBool,
      automaticRequired: lenientBool,
      diesel: lenientBool,
      winterTyres: lenientBool,
      foreignTravel: lenientBool,
      childSeat: lenientBool,
    }),
  ),
  foreignCountries: lenient(z.array(z.string())),
  expectedKmPerDay: lenientInt,
  minPayloadKg: lenientInt,
  handover: lenient(z.object({ mode: lenient(z.enum(HANDOVER_MODES)), branch: lenientText, address: previewAddress })),
  dropOff: lenient(z.object({ mode: lenient(z.enum(DROP_OFF_MODES)), branch: lenientText, address: previewAddress })),
  driver: lenient(
    z.object({
      firstName: lenientText,
      lastName: lenientText,
      email: lenientText,
      phone: lenientText,
      birthDate: lenientText,
      licenceNumber: lenientText,
      additionalDrivers: lenientText,
    }),
  ),
  specialEquipmentReason: lenientText,
});

const previewTrainSchema = z.object({
  tripType: lenient(tripTypeSchema),
  outboundAt: lenientDateTime,
  returnAt: lenientDateTime,
  fromStation: lenientText,
  viaStation: lenientText,
  toStation: lenientText,
  fareType: lenient(fareTypeSchema),
  seatReservations: lenientInt,
  separateTickets: lenientBool,
  localTransportTicket: lenientBool,
  companionIds: lenient(z.array(z.uuid())),
  notes: lenientText,
});

const previewFlightSchema = z.object({
  tripType: lenient(tripTypeSchema),
  outboundDepartureAt: lenientDateTime,
  outboundFrom: lenientText,
  outboundTo: lenientText,
  returnDepartureAt: lenientDateTime,
  returnFrom: lenientText,
  returnTo: lenientText,
  handLuggageOnly: lenientBool,
  notes: lenientText,
});

export const travelPreviewRequestSchema = z.object({
  kind: travelKindSchema,
  travellerId: z.uuid(),
  approverId: lenientUuid,
  costCenterId: lenientUuid,
  costCenterReason: lenientText,
  recharge: lenient(z.object({ customer: lenientText, projectNumber: lenientText })),
  comment: lenientText,
  car: lenient(previewCarSchema),
  train: lenient(previewTrainSchema),
  flight: lenient(previewFlightSchema),
});
export class TravelPreviewRequestDto extends createZodDto(travelPreviewRequestSchema) {}
export type TravelPreviewInput = z.infer<typeof travelPreviewRequestSchema>;

export const travelPreviewSchema = z.object({
  needsApproval: z.boolean(),
  reasons: z.array(reasonDtoSchema),
  exemption: exemptionDtoSchema.nullable(),
  approverCandidates: z.array(approverCandidateSchema),
  defaultApproverId: z.uuid().nullable(),
  /** 'requester_is_approver' when the chosen approver is the requester. */
  autoApproval: autoApprovalSchema.nullable(),
  isHighPriority: z.boolean(),
  specialEquipmentReasonRequired: z.boolean(),
});
export class TravelPreviewDto extends createZodDto(travelPreviewSchema) {}

// ---------------------------------------------------------------------------
// Action bodies (API.md §5.3 + SPEC_RESOLUTIONS #11 `close`)
// ---------------------------------------------------------------------------

export const PIN_PATTERN = /^[A-Za-z0-9]{4,12}$/;

export const bookBodySchema = z.strictObject({
  bookingNumber: z.string().trim().min(1).max(60),
  pin: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || PIN_PATTERN.test(v), 'The PIN must be 4-12 letters or digits.'),
  comment: optionalTextSchema(2000),
  attachmentIds: z.array(z.uuid()).min(1).max(5),
});
export type BookBody = z.infer<typeof bookBodySchema>;
