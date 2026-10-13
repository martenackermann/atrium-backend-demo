/**
 * Travel vocabulary (API.md §2.2, SPEC §5.2 / §6.3). String values equal the Prisma enum
 * values and the API values.
 */

export const TRAVEL_KINDS = ['car', 'train', 'flight'] as const;
export type TravelKind = (typeof TRAVEL_KINDS)[number];

export const TRAVEL_STATUSES = [
  'pending_approval',
  'to_book',
  'booked',
  'declined',
  'booking_impossible',
  'cancellation_requested',
  'cancelled',
] as const;
export type TravelStatus = (typeof TRAVEL_STATUSES)[number];

/** Non-terminal states ("active" trips). */
export const ACTIVE_TRAVEL_STATUSES: TravelStatus[] = [
  'pending_approval',
  'to_book',
  'booked',
  'booking_impossible',
  'cancellation_requested',
];

/** States that can be high priority (SPEC §5.2). */
export const HIGH_PRIORITY_STATUSES: TravelStatus[] = ['pending_approval', 'to_book'];

/** SPEC §6.3 - evaluation (and display) order. */
export const APPROVAL_REASON_CODES = [
  'vehicle_class_upgrade',
  'car_estate',
  'car_automatic_preferred',
  'car_automatic_required',
  'car_diesel',
  'car_foreign_travel',
  'car_delivery',
  'car_collection',
  'train_saver_fare',
  'train_separate_tickets',
  'flight',
] as const;
export type ApprovalReasonCode = (typeof APPROVAL_REASON_CODES)[number];

export const APPROVAL_REASON_LABELS: Record<ApprovalReasonCode, string> = {
  vehicle_class_upgrade: 'Vehicle class above standard',
  car_estate: 'Estate car',
  car_automatic_preferred: 'Automatic transmission (preferred)',
  car_automatic_required: 'Automatic transmission (guaranteed)',
  car_diesel: 'Diesel engine',
  car_foreign_travel: 'Foreign travel',
  car_delivery: 'Delivery to an address',
  car_collection: 'Collection from an address',
  train_saver_fare: 'Saver fare (non-refundable)',
  train_separate_tickets: 'Separate tickets per traveller',
  flight: 'Flights always need approval',
};

/** Reasons that require `specialEquipmentReason` (≥ 10 characters) on car requests. */
export const SPECIAL_EQUIPMENT_REASON_CODES: readonly ApprovalReasonCode[] = [
  'vehicle_class_upgrade',
  'car_estate',
  'car_automatic_preferred',
  'car_automatic_required',
  'car_diesel',
  'car_foreign_travel',
  'car_delivery',
  'car_collection',
];

export const APPROVAL_EXEMPTIONS = ['executive_traveller'] as const;
export type ApprovalExemptionCode = (typeof APPROVAL_EXEMPTIONS)[number];
export const APPROVAL_EXEMPTION_LABELS: Record<ApprovalExemptionCode, string> = {
  executive_traveller: 'Executive travellers approve their own trips',
};

export const VEHICLE_TYPES = ['car', 'van'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];
export const HANDOVER_MODES = ['branch', 'delivery'] as const;
export const DROP_OFF_MODES = ['branch', 'collection'] as const;
export const TRIP_TYPES = ['one_way', 'return'] as const;
export const FARE_TYPES = ['saver', 'flex'] as const;

/**
 * Action slugs in canonical order (availableActions keeps it). `close` comes from
 * SPEC_RESOLUTIONS #11; `view_pin` is a capability flag (GET .../booking/pin).
 */
export const TRAVEL_ACTIONS = [
  'approve',
  'decline',
  'withdraw',
  'request_cancellation',
  'confirm_cancellation',
  'reject_cancellation',
  'book',
  'mark_booking_impossible',
  'retry_booking',
  'close',
  'view_pin',
] as const;
export type TravelAction = (typeof TRAVEL_ACTIONS)[number];

export const KIND_LABELS: Record<TravelKind, string> = { car: 'Car', train: 'Train', flight: 'Flight' };

/** Reference: `TRV-000045`. */
export const travelReference = (number: number): string => `TRV-${String(number).padStart(6, '0')}`;

/** Exact reference match (case-insensitive): returns the number or null. */
export function parseTravelReference(q: string): number | null {
  const match = /^TRV-(\d{1,9})$/i.exec(q.trim());
  return match ? Number(match[1]) : null;
}

/** Entity types used in audit rows and attachments. */
export const TRAVEL_ENTITY = 'travel_request';
export const TRAVEL_BOOKING_ENTITY = 'travel_booking';
export const CAR_CLASS_ENTITY = 'car_rental_class';
