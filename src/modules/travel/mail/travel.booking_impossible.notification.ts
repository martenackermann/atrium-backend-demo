import { z } from 'zod';
import { mjml } from '@/infra/mail/mjml';
import { defineNotification } from '@/modules/core/notifications/notification-template';
import { factsBlock, PREVIEW_BASE, requestLink, travelMailBaseSchema } from './travel-mail.helpers';

/** SPEC §7 `travel.booking_impossible`: → booking_impossible; to traveller, cc requester. */
export const travelBookingImpossible = defineNotification({
  id: 'travel.booking_impossible',
  module: 'travel',
  description: 'The travel desk could not book a trip.',
  schema: travelMailBaseSchema.extend({ reason: z.string() }),
  subject: (c) => `Booking not possible: ${c.route}`,
  body: (c) => `The travel desk could not book ${c.route}: ${c.reason}`,
  email: (c) => mjml`
    <mj-text font-size="18px" font-weight="600">Booking not possible</mj-text>
    <mj-text>The travel desk could not book this trip.</mj-text>
    ${factsBlock(c)}
    <mj-text>Reason: ${c.reason}</mj-text>
    <mj-text color="#6b7785">The desk may retry later. If you no longer need the trip, withdraw it in Atrium.</mj-text>`,
  link: (c) => requestLink(c),
  preview: { ...PREVIEW_BASE, reason: 'No vans available at the Riverton branch on these dates.' },
});
