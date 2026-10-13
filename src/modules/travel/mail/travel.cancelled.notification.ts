import { z } from 'zod';
import { mjml } from '@/infra/mail/mjml';
import { defineNotification } from '@/modules/core/notifications/notification-template';
import { factsBlock, mutedLine, PREVIEW_BASE, requestLink, travelMailBaseSchema } from './travel-mail.helpers';

/** SPEC §7 `travel.cancelled`: → cancelled by the desk (confirm or close); to traveller, cc requester. */
export const travelCancelled = defineNotification({
  id: 'travel.cancelled',
  module: 'travel',
  description: 'The travel desk cancelled a trip.',
  schema: travelMailBaseSchema.extend({ comment: z.string().nullable() }),
  subject: (c) => `Cancelled: ${c.route}`,
  body: (c) => `The travel desk cancelled ${c.route}.${c.comment ? ` ${c.comment}` : ''}`,
  email: (c) => mjml`
    <mj-text font-size="18px" font-weight="600">Trip cancelled</mj-text>
    <mj-text>The travel desk cancelled this trip.</mj-text>
    ${factsBlock(c)}
    ${mutedLine('Comment', c.comment)}`,
  link: (c) => requestLink(c),
  preview: { ...PREVIEW_BASE, comment: 'Rental cancelled free of charge.' },
});
