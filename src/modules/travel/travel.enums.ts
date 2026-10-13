import type { AuditLabels } from '@/modules/core/audit/audit-label.registry';
import { type EnumOption, enumOptions } from '@/modules/core/meta/enum.registry';
import {
  APPROVAL_EXEMPTION_LABELS,
  APPROVAL_EXEMPTIONS,
  APPROVAL_REASON_CODES,
  APPROVAL_REASON_LABELS,
  CAR_CLASS_ENTITY,
  DROP_OFF_MODES,
  FARE_TYPES,
  HANDOVER_MODES,
  TRAVEL_ENTITY,
  TRAVEL_KINDS,
  TRAVEL_STATUSES,
  TRIP_TYPES,
  VEHICLE_TYPES,
} from './travel.constants';

/**
 * Travel enums for `GET /meta/enums` (API.md §3.6). Labels per API.md; tones from DESIGN §2.4
 * (SPEC_RESOLUTIONS #8 - the viewer-relative `you` tone is applied client-side).
 */
export const TRAVEL_ENUMS: Record<string, EnumOption[]> = {
  travelKind: enumOptions(TRAVEL_KINDS),
  travelStatus: enumOptions(TRAVEL_STATUSES, {
    pending_approval: ['Awaiting approval', 'waiting'],
    to_book: ['To book', 'moving'],
    booked: ['Booked', 'positive'],
    declined: ['Declined', 'negative'],
    booking_impossible: ['Booking impossible', 'blocked'],
    cancellation_requested: ['Cancellation requested', 'waiting'],
    cancelled: ['Cancelled', 'neutral'],
  }),
  approvalReason: enumOptions(APPROVAL_REASON_CODES, APPROVAL_REASON_LABELS),
  approvalExemption: enumOptions(APPROVAL_EXEMPTIONS, APPROVAL_EXEMPTION_LABELS),
  vehicleType: enumOptions(VEHICLE_TYPES),
  handoverMode: enumOptions(HANDOVER_MODES),
  dropOffMode: enumOptions(DROP_OFF_MODES),
  tripType: enumOptions(TRIP_TYPES),
  fareType: enumOptions(FARE_TYPES, { saver: 'Saver fare', flex: 'Flex fare' }),
};

/** Field labels and timeline phrases (SPEC_RESOLUTIONS #6). */
export const TRAVEL_AUDIT_LABELS: Record<string, AuditLabels> = {
  [TRAVEL_ENTITY]: {
    entity: 'Travel request',
    actions: {
      create: 'submitted the request',
      auto_approve: 'approved automatically',
      approve: 'approved the trip',
      decline: 'declined the trip',
      withdraw: 'withdrew the request',
      book: 'booked the trip',
      mark_booking_impossible: 'marked the booking as impossible',
      retry_booking: 'retried the booking',
      close: 'closed the request',
      request_cancellation: 'requested cancellation',
      confirm_cancellation: 'confirmed the cancellation',
      reject_cancellation: 'rejected the cancellation',
      view_pin: 'viewed the booking PIN',
    },
  },
  [CAR_CLASS_ENTITY]: {
    entity: 'Car class',
    fields: {
      code: 'Code',
      name: 'Name',
      description: 'Description',
      exampleModels: 'Example models',
      vehicleType: 'Vehicle type',
      isDefault: 'Standard class',
      sortOrder: 'Sort order',
      active: 'Active',
    },
  },
};
