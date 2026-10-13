import { addDaysIso, type IsoDate } from '@/common/time/time';

/** API.md §2.2 AttendeeStatus (same values as the Prisma enum TrainingAttendeeStatus). */
export const ATTENDEE_STATUSES = [
  'pending_manager_approval',
  'pending_executive_approval',
  'to_book',
  'booked',
  'declined',
  'booking_impossible',
  'cancellation_requested',
  'cancelled',
  'attended',
  'not_attended',
] as const;
export type AttendeeStatus = (typeof ATTENDEE_STATUSES)[number];

export const PENDING_STATUSES = ['pending_manager_approval', 'pending_executive_approval'] as const;

/** States in which a participation still "moves" (counts as active for the attendee). */
export const ACTIVE_STATUSES: readonly AttendeeStatus[] = [
  'pending_manager_approval',
  'pending_executive_approval',
  'to_book',
  'booked',
  'booking_impossible',
  'cancellation_requested',
];

/** States that can carry the high-priority flag (API.md TrainingAttendeeDto.isHighPriority). */
export const HIGH_PRIORITY_STATUSES: readonly AttendeeStatus[] = [
  'pending_manager_approval',
  'pending_executive_approval',
  'to_book',
];

/** Goals may be edited by the attendee in these states while `startsOn > today` (SPEC §5.1). */
export const GOALS_EDITABLE_STATUSES: readonly AttendeeStatus[] = [
  'pending_manager_approval',
  'pending_executive_approval',
  'to_book',
  'booked',
];

export const TRAINING_FORMATS = ['in_person', 'online', 'hybrid'] as const;
export type TrainingFormat = (typeof TRAINING_FORMATS)[number];

export const BILLING_STATUSES = ['open', 'invoice_received', 'free_of_charge'] as const;
export type BillingStatus = (typeof BILLING_STATUSES)[number];

export const RATING_STATES = ['upcoming', 'due', 'overdue', 'submitted'] as const;
export type RatingState = (typeof RATING_STATES)[number];

export const LIKERT = ['A', 'B', 'C', 'D'] as const;
export type Likert = (typeof LIKERT)[number];

/** Canonical order of TrainingAttendeeAction (API.md §4.2 + `close`, SPEC_RESOLUTIONS #11). */
export const ATTENDEE_ACTIONS = [
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
  'edit_goals',
] as const;
export type AttendeeAction = (typeof ATTENDEE_ACTIONS)[number];

export const REQUEST_ACTIONS = ['edit', 'edit_back_office', 'add_attendee', 'add_attachment'] as const;
export type RequestAction = (typeof REQUEST_ACTIONS)[number];

/** Back-office actions on participations (CASL `TrainingAttendee`). */
export const BACK_OFFICE_ACTIONS = [
  'book',
  'mark_booking_impossible',
  'retry_booking',
  'confirm_cancellation',
  'reject_cancellation',
  'close',
] as const;

export const MAX_ATTENDEES = 20;

/** `TRN-000123` */
export function trainingReference(num: number): string {
  return `TRN-${String(num).padStart(6, '0')}`;
}

/** Parses `TRN-000123` / `trn-123` into 123, else null. */
export function parseTrainingReference(q: string): number | null {
  const match = /^TRN-?0*(\d{1,9})$/i.exec(q.trim());
  return match ? Number(match[1]) : null;
}

/** Derived rating state (SPEC §4.2). */
export function ratingState(
  rating: { dueAt: Date; submittedAt: Date | null },
  now: Date,
  overdueDays: number,
): RatingState {
  if (rating.submittedAt) return 'submitted';
  if (rating.dueAt.getTime() > now.getTime()) return 'upcoming';
  if (now.getTime() > rating.dueAt.getTime() + overdueDays * 86_400_000) return 'overdue';
  return 'due';
}

/**
 * High priority = pending or to book, starting today or within `days` days
 * (future starts only, SPEC_RESOLUTIONS #11).
 */
export function isHighPriority(status: string, startsOn: IsoDate, today: IsoDate, days: number): boolean {
  return (
    (HIGH_PRIORITY_STATUSES as readonly string[]).includes(status) &&
    startsOn >= today &&
    startsOn <= addDaysIso(today, days)
  );
}

// --- Display formatting (en-GB, DESIGN.md §10) -----------------------------------------

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parts(iso: IsoDate) {
  const date = new Date(`${iso}T00:00:00.000Z`);
  return { wd: WEEKDAY[date.getUTCDay()], day: date.getUTCDate(), mon: MONTH[date.getUTCMonth()], year: date.getUTCFullYear() };
}

/** "Tue 21 Oct" (+ year when it differs from `today`'s year). */
export function formatDate(iso: IsoDate, today?: IsoDate): string {
  const p = parts(iso);
  const showYear = !today || Number(today.slice(0, 4)) !== p.year;
  return `${p.wd} ${p.day} ${p.mon}${showYear ? ` ${p.year}` : ''}`;
}

/** "21–23 Oct", "30 Oct – 2 Nov", or a single day "Tue 21 Oct" (+ year when not the current year). */
export function formatDateRange(startsOn: IsoDate, endsOn: IsoDate, today?: IsoDate): string {
  if (startsOn === endsOn) return formatDate(startsOn, today);
  const a = parts(startsOn);
  const b = parts(endsOn);
  const showYear = !today || Number(today.slice(0, 4)) !== b.year || a.year !== b.year;
  const year = showYear ? ` ${b.year}` : '';
  if (a.year === b.year && a.mon === b.mon) return `${a.day}–${b.day} ${b.mon}${year}`;
  if (a.year === b.year) return `${a.day} ${a.mon} – ${b.day} ${b.mon}${year}`;
  return `${a.day} ${a.mon} ${a.year} – ${b.day} ${b.mon} ${b.year}`;
}

/** "€1,890" or "€1,890.50". */
export function formatMoney(amountCents: number): string {
  const euros = Math.floor(amountCents / 100);
  const cents = amountCents % 100;
  const whole = euros.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `€${whole}${cents ? `.${String(cents).padStart(2, '0')}` : ''}`;
}

/** CSV money: decimal euros "890.00" (API.md §1). */
export function csvMoney(amountCents: number | null | undefined): string {
  if (amountCents === null || amountCents === undefined) return '';
  return (amountCents / 100).toFixed(2);
}
