import { z } from 'zod';
import { mjml, raw } from '@/infra/mail/mjml';

/** Context fields every participation notification carries (pre-formatted, en-GB). */
export const participationContextSchema = z.object({
  attendeeId: z.uuid(),
  attendee: z.string(),
  topic: z.string(),
  reference: z.string(),
  provider: z.string(),
  /** e.g. "21–22 Oct" */
  dates: z.string(),
});
export type ParticipationContext = z.infer<typeof participationContextSchema>;

export const PREVIEW_PARTICIPATION: ParticipationContext = {
  attendeeId: '0192f1c2-8e4b-7c3a-9d2e-1a2b3c4d5e6f',
  attendee: 'Emma Employee',
  topic: 'Customer Communication Masterclass',
  reference: 'TRN-000001',
  provider: 'Brightpath Academy',
  dates: '3–4 Nov',
};

export const participationLink = (c: { attendeeId: string }) => `/training/participations/${c.attendeeId}`;

/** A two-column facts table (label / value); null values are skipped. */
export function facts(rows: [string, string | null | undefined][]): ReturnType<typeof raw> {
  const visible = rows.filter(([, value]) => value !== null && value !== undefined && value !== '');
  return raw(
    mjml`<mj-table cellpadding="4px" font-size="14px">${visible.map(([label, value]) =>
      raw(mjml`<tr><td style="color:#6b7785;width:160px;vertical-align:top">${label}</td><td>${value}</td></tr>`),
    )}</mj-table>`,
  );
}

/** Optional muted paragraph. */
export function note(text: string | null | undefined): ReturnType<typeof raw> | '' {
  return text ? raw(mjml`<mj-text color="#57524A">${text}</mj-text>`) : '';
}
