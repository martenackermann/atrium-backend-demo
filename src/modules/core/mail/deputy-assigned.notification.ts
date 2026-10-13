import { z } from 'zod';
import { mjml, raw } from '@/infra/mail/mjml';
import { defineNotification } from '../notifications/notification-template';

function windowText(validFrom: string | null, validTo: string | null): string {
  if (!validFrom && !validTo) return 'permanently (no end date)';
  if (validFrom && validTo) return `from ${validFrom} to ${validTo}`;
  return validFrom ? `from ${validFrom}` : `until ${validTo}`;
}

/** SPEC §7 `core.deputy_assigned`: deputy created -> deputy. */
export const deputyAssignedNotification = defineNotification({
  id: 'core.deputy_assigned',
  module: 'core',
  description: 'A user named the recipient as their deputy.',
  schema: z.object({
    principalName: z.string(),
    deputyName: z.string(),
    validFrom: z.string().nullable(),
    validTo: z.string().nullable(),
    note: z.string().nullable(),
  }),
  subject: (c) => `${c.principalName} named you as deputy`,
  body: (c) =>
    `You can approve training and travel requests for ${c.principalName} ${windowText(c.validFrom, c.validTo)}.${c.note ? ` Note: ${c.note}` : ''}`,
  email: (c) => mjml`
    <mj-text font-size="18px" font-weight="600">Hello ${c.deputyName},</mj-text>
    <mj-text>${c.principalName} named you as their deputy. You can approve training and travel requests on their behalf ${windowText(c.validFrom, c.validTo)}.</mj-text>
    ${c.note ? raw(mjml`<mj-text color="#6b7785">Note: ${c.note}</mj-text>`) : ''}
    <mj-text>You can't approve your own requests.</mj-text>`,
  link: () => '/settings/deputies',
  preview: {
    principalName: 'Priya Raman',
    deputyName: 'Max Manager',
    validFrom: '2026-10-11',
    validTo: '2026-10-25',
    note: 'Annual leave',
  },
});
