import { z } from 'zod';
import { mjml, raw } from '@/infra/mail/mjml';
import { defineNotification } from '@/modules/core/notifications/notification-template';

const cell = 'padding:4px 8px 4px 0;vertical-align:top;';

/** SPEC §7 `travel.high_priority_digest`: job; travel-desk mailbox; always high priority. */
export const travelHighPriorityDigest = defineNotification({
  id: 'travel.high_priority_digest',
  module: 'travel',
  description: 'List of trips starting soon that are not booked yet.',
  schema: z.object({
    count: z.number().int(),
    days: z.number().int(),
    items: z.array(
      z.object({
        reference: z.string(),
        kind: z.string(),
        route: z.string(),
        traveller: z.string(),
        when: z.string(),
        status: z.string(),
      }),
    ),
  }),
  subject: (c) => `${c.count} high-priority travel request${c.count === 1 ? '' : 's'}`,
  body: (c) =>
    `${c.count} trip${c.count === 1 ? ' starts' : 's start'} within ${c.days} days and ${c.count === 1 ? 'is' : 'are'} not booked yet.`,
  email: (c) => mjml`
    <mj-text font-size="18px" font-weight="600">${c.count} trip${c.count === 1 ? '' : 's'} starting within ${c.days} days</mj-text>
    <mj-text>These requests still wait for approval or booking.</mj-text>
    <mj-table font-size="13px" color="#1f2933" padding="8px 0">
      <tr style="text-align:left;color:#6b7785;"><th style="${cell}">Reference</th><th style="${cell}">Trip</th><th style="${cell}">Traveller</th><th style="${cell}">Starts</th><th style="${cell}">Status</th></tr>
      ${c.items.map((i) => raw(mjml`<tr><td style="${cell}">${i.reference}</td><td style="${cell}">${i.kind} · ${i.route}</td><td style="${cell}">${i.traveller}</td><td style="${cell}">${i.when}</td><td style="${cell}">${i.status}</td></tr>`))}
    </mj-table>`,
  link: () => '/back-office/travel?queue=to_book&highPriority=true',
  preview: {
    count: 2,
    days: 3,
    items: [
      {
        reference: 'TRV-000007',
        kind: 'Train',
        route: 'Hillford Central → Riverton Central',
        traveller: 'Sofia Site-Manager',
        when: 'Wed 14 Oct 2026, 07:40',
        status: 'To book',
      },
      {
        reference: 'TRV-000009',
        kind: 'Car',
        route: 'Hillford → Eastgate',
        traveller: 'Field Technician',
        when: 'Thu 15 Oct 2026, 08:00',
        status: 'Awaiting approval',
      },
    ],
  },
});
