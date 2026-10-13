import {
  APPROVAL_REASON_CODES,
  type ApprovalReasonCode,
  HIGH_PRIORITY_STATUSES,
  SPECIAL_EQUIPMENT_REASON_CODES,
  type TravelKind,
  type TravelStatus,
} from '../travel.constants';

/**
 * Pure travel business rules (SPEC §6.3 needsApproval, SPEC_RESOLUTIONS #9 route string,
 * §5.2 high priority). Used by create, preview and the seed, so they never drift.
 */

export interface CarRuleInput {
  /** `isDefault` of the chosen class for its vehicle type (null = unknown / not chosen yet). */
  classIsDefault?: boolean | null;
  equipment?: {
    estate?: boolean | null;
    automaticPreferred?: boolean | null;
    automaticRequired?: boolean | null;
    diesel?: boolean | null;
    foreignTravel?: boolean | null;
  } | null;
  handoverMode?: 'branch' | 'delivery' | null;
  dropOffMode?: 'branch' | 'collection' | null;
}

export interface TrainRuleInput {
  fareType?: 'saver' | 'flex' | null;
  separateTickets?: boolean | null;
}

export interface ApprovalRuleInput {
  kind: TravelKind;
  car?: CarRuleInput | null;
  train?: TrainRuleInput | null;
}

/**
 * All matching reason codes in SPEC §6.3 order. Works on partial input (the preview):
 * unknown values simply do not add a reason.
 */
export function evaluateApprovalReasons(input: ApprovalRuleInput): ApprovalReasonCode[] {
  const found = new Set<ApprovalReasonCode>();
  if (input.kind === 'car' && input.car) {
    const { car } = input;
    const eq = car.equipment ?? {};
    if (car.classIsDefault === false) found.add('vehicle_class_upgrade');
    if (eq.estate) found.add('car_estate');
    if (eq.automaticPreferred && !eq.automaticRequired) found.add('car_automatic_preferred');
    if (eq.automaticRequired) found.add('car_automatic_required');
    if (eq.diesel) found.add('car_diesel');
    if (eq.foreignTravel) found.add('car_foreign_travel');
    if (car.handoverMode === 'delivery') found.add('car_delivery');
    if (car.dropOffMode === 'collection') found.add('car_collection');
  }
  if (input.kind === 'train' && input.train) {
    if (input.train.fareType === 'saver') found.add('train_saver_fare');
    if (input.train.separateTickets) found.add('train_separate_tickets');
  }
  if (input.kind === 'flight') found.add('flight');
  return APPROVAL_REASON_CODES.filter((code) => found.has(code));
}

/** A car request needs `specialEquipmentReason` when any car reason applies. */
export function specialEquipmentReasonRequired(reasons: readonly ApprovalReasonCode[]): boolean {
  return reasons.some((code) => SPECIAL_EQUIPMENT_REASON_CODES.includes(code));
}

export interface RouteInput {
  kind: TravelKind;
  car?: {
    handoverMode: 'branch' | 'delivery';
    handoverBranch?: string | null;
    handoverCity?: string | null;
    destination: string;
  } | null;
  train?: { fromStation: string; viaStation?: string | null; toStation: string } | null;
  flight?: { outboundFrom: string; outboundTo: string } | null;
}

const ARROW = ' → ';

/**
 * SPEC_RESOLUTIONS #9: car `"{handover branch/city} → {destination}"`, train
 * `"{from} → {via} → {to}"`, flight `"{outFrom} → {outTo}"`.
 */
export function buildRoute(input: RouteInput): string {
  switch (input.kind) {
    case 'car': {
      const car = input.car!;
      const origin = (car.handoverMode === 'branch' ? car.handoverBranch : car.handoverCity) ?? '';
      return [origin.trim(), car.destination.trim()].filter(Boolean).join(ARROW);
    }
    case 'train': {
      const train = input.train!;
      return [train.fromStation, train.viaStation, train.toStation]
        .map((s) => s?.trim())
        .filter(Boolean)
        .join(ARROW);
    }
    case 'flight':
      return `${input.flight!.outboundFrom.trim()}${ARROW}${input.flight!.outboundTo.trim()}`;
  }
}

const DAY_MS = 86_400_000;

/**
 * SPEC §5.2 + SPEC_RESOLUTIONS #11: pending or to-book trips starting within
 * `days` days - future starts only.
 */
export function isHighPriority(status: TravelStatus, startsAt: Date, now: Date, days: number): boolean {
  if (!HIGH_PRIORITY_STATUSES.includes(status)) return false;
  return startsAt.getTime() > now.getTime() && startsAt.getTime() <= now.getTime() + days * DAY_MS;
}

/** Prisma filter for `isHighPriority`. */
export function highPriorityWhere(now: Date, days: number) {
  return {
    status: { in: HIGH_PRIORITY_STATUSES },
    startsAt: { gt: now, lte: new Date(now.getTime() + days * DAY_MS) },
  };
}

/** Driver must be ≥ 18 years old at pickup (birth date and pickup as IsoDates). */
export function isAdultOn(birthDate: string, onDate: string): boolean {
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [y, m, d] = onDate.split('-').map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age--;
  return age >= 18;
}
