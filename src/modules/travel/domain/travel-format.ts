/** Human date formatting for travel emails, inbox subtitles and CSV (APP_TIMEZONE, English). */

export function formatDateTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
}

export function formatDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short', year: 'numeric' }).format(
    instant,
  );
}

/** "Thu 22 Oct 2026, 09:00 – Sat 24 Oct 2026, 18:00" (or just the start for one-way trips). */
export function formatTripWhen(startsAt: Date, endsAt: Date | null, timeZone: string): string {
  const start = formatDateTime(startsAt, timeZone);
  return endsAt ? `${start} – ${formatDateTime(endsAt, timeZone)}` : start;
}

export type CsvValue = string | number | boolean | null | undefined;

/**
 * RFC 4180 CSV cell. Text starting with = + - @ TAB or CR gets a leading apostrophe, so
 * spreadsheet apps show it instead of evaluating a formula (CSV injection): user input such as
 * stations, branches or recharge customers ends up in the export.
 */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const BOM = String.fromCharCode(0xfeff);

/** CSV document with BOM (API.md §1 "CSV exports"). */
export function toCsv(header: string[], rows: CsvValue[][]): string {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(','));
  return `${BOM}${lines.join('\r\n')}\r\n`;
}
