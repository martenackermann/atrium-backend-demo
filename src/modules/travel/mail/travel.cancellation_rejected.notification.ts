import { z } from 'zod';
import { mjml } from '@/infra/mail/mjml';
import { defineNotification } from '@/modules/core/notifications/notification-template';
import { factsBlock, PREVIEW_BASE, requestLink, travelMailBaseSchema } from './travel-mail.helpers';

/** SPEC §7 `travel.cancellation_rejected`: reject_cancellation; to traveller, cc requester. */
export const travelCancellationRejected = defineNotification({
  id: 'travel.cancellation_rejected',
  module: 'travel',
  description: 'The travel desk could not cancel a trip.',
  schema: travelMailBaseSchema.extend({ reason: z.string(), restoredState: z.string() }),
  subject: (c) => `Cancellation not possible: ${c.route}`,
  body: (c) =>
    `The travel desk could not cancel ${c.route}: ${c.reason} The trip stays ${c.restoredState.toLowerCase()}.`,
  email: (c) => mjml`
    <mj-text font-size="18px" font-weight="600">Cancellation not possible</mj-text>
    <mj-text>The travel desk could not cancel this trip. It stays ${c.restoredState.toLowerCase()}.</mj-text>
    ${factsBlock(c)}
    <mj-text>Reason: ${c.reason}</mj-text>`,
  link: (c) => requestLink(c),
  preview: { ...PREVIEW_BASE, reason: 'The fare is non-refundable.', restoredState: 'Booked' },
});
