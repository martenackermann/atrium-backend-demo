import { z } from 'zod';
import { mjml } from '@/infra/mail/mjml';
import { defineNotification } from '@/modules/core/notifications/notification-template';
import { factsBlock, PREVIEW_BASE, requestLink, travelMailBaseSchema } from './travel-mail.helpers';

/** SPEC §7 `travel.cancellation_requested`: travel-desk mailbox, cc traveller. */
export const travelCancellationRequested = defineNotification({
  id: 'travel.cancellation_requested',
  module: 'travel',
  description: 'A traveller or requester asks the travel desk to cancel a trip.',
  schema: travelMailBaseSchema.extend({ actor: z.string(), reason: z.string(), previousState: z.string() }),
  subject: (c) => `Cancellation requested: ${c.route}`,
  body: (c) => `${c.actor} asks to cancel ${c.route} (${c.previousState.toLowerCase()}): ${c.reason}`,
  email: (c) => mjml`
    <mj-text font-size="18px" font-weight="600">Cancellation requested</mj-text>
    <mj-text>${c.actor} asks the travel desk to cancel this trip (currently: ${c.previousState.toLowerCase()}).</mj-text>
    ${factsBlock(c)}
    <mj-text>Reason: ${c.reason}</mj-text>`,
  link: (c) => requestLink(c),
  preview: { ...PREVIEW_BASE, actor: 'Emma Employee', reason: 'The workshop was postponed.', previousState: 'Booked' },
});
