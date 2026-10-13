import { z } from 'zod';
import { mjml, raw } from '@/infra/mail/mjml';
import { TRAVEL_KINDS, type TravelKind } from '../travel.constants';

/**
 * Shared pieces of the travel notification templates (SPEC §7). Not a template file itself
 * (the registry only loads `*.notification.ts`).
 */
export const travelMailBaseSchema = z.object({
  requestId: z.uuid(),
  reference: z.string(),
  kind: z.enum(TRAVEL_KINDS),
  route: z.string(),
  traveller: z.string(),
  /** Pre-formatted trip dates in APP_TIMEZONE, e.g. "Thu 22 Oct 2026, 09:00 – Sat 24 Oct 2026, 18:00". */
  when: z.string(),
});
export type TravelMailBase = z.infer<typeof travelMailBaseSchema>;

/** Friendly noun: "rental car", "train journey", "flight". */
export const KIND_NOUN: Record<TravelKind, string> = { car: 'rental car', train: 'train journey', flight: 'flight' };

export const requestLink = (c: { requestId: string }) => `/travel/requests/${c.requestId}`;

/** Reference / trip / dates block shown in every travel email. */
export function factsBlock(c: TravelMailBase): ReturnType<typeof raw> {
  return raw(mjml`
    <mj-table font-size="14px" color="#1f2933" padding="8px 0">
      <tr><td style="padding:2px 12px 2px 0;color:#6b7785;">Reference</td><td>${c.reference}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#6b7785;">Traveller</td><td>${c.traveller}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#6b7785;">Trip</td><td>${KIND_NOUN[c.kind]} · ${c.route}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#6b7785;">When</td><td>${c.when}</td></tr>
    </mj-table>`);
}

/** Optional muted line (comment, note). */
export function mutedLine(label: string, text: string | null | undefined): ReturnType<typeof raw> | '' {
  return text ? raw(mjml`<mj-text color="#6b7785">${label}: ${text}</mj-text>`) : '';
}

export const PREVIEW_BASE: TravelMailBase = {
  requestId: '00000000-0000-7000-8000-000000000001',
  reference: 'TRV-000001',
  kind: 'car',
  route: 'Riverton → Westbay',
  traveller: 'Emma Employee',
  when: 'Thu 22 Oct 2026, 09:00 – Sat 24 Oct 2026, 18:00',
};
