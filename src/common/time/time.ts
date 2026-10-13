import { addDays as addDaysFns } from 'date-fns';

/** 'YYYY-MM-DD' */
export type IsoDate = string;

/** Calendar date of `instant` in `timeZone` (IANA), as IsoDate. */
export function isoDateInZone(instant: Date, timeZone: string): IsoDate {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    instant,
  );
}

/** Prisma `@db.Date` values are UTC midnights: IsoDate -> Date. */
export function dateFromIso(iso: IsoDate): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** Prisma `@db.Date` value -> IsoDate. */
export function isoFromDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

export function isoFromDateOrNull(date: Date | null | undefined): IsoDate | null {
  return date ? isoFromDate(date) : null;
}

export function addDaysIso(iso: IsoDate, days: number): IsoDate {
  return isoFromDate(addDaysFns(dateFromIso(iso), days));
}

/** UTC instant of local midnight of `iso` in `timeZone` (e.g. a training's start as IsoDateTime). */
export function startOfDayInZone(iso: IsoDate, timeZone: string): Date {
  const utcMidnight = dateFromIso(iso);
  const offsetMinutes = zoneOffsetMinutes(utcMidnight, timeZone);
  const candidate = new Date(utcMidnight.getTime() - offsetMinutes * 60_000);
  // Correct for a DST change between UTC midnight and local midnight.
  const corrected = zoneOffsetMinutes(candidate, timeZone);
  return corrected === offsetMinutes ? candidate : new Date(utcMidnight.getTime() - corrected * 60_000);
}

function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** True when `day` lies in [from, to] (null bounds are open). IsoDates compare lexicographically. */
export function withinWindow(day: IsoDate, from: IsoDate | null, to: IsoDate | null): boolean {
  return (from === null || from <= day) && (to === null || to >= day);
}
