import { z } from 'zod';
import { mjml } from '@/infra/mail/mjml';
import { defineNotification } from '@/modules/core/notifications/notification-template';
import { factsBlock, mutedLine, PREVIEW_BASE, requestLink, travelMailBaseSchema } from './travel-mail.helpers';

/** SPEC §7 `travel.approved`: → to_book via approval; travel-desk mailbox, cc traveller + requester. */
export const travelApproved = defineNotification({
  id: 'travel.approved',
  module: 'travel',
  description: 'A trip was approved; the travel desk books it next.',
  schema: travelMailBaseSchema.extend({
    approver: z.string(),
    comment: z.string().nullable(),
    automatic: z.boolean(),
  }),
  subject: (c) => `Approved – to book: ${c.kind} ${c.route}`,
  body: (c) =>
    `${c.approver} ${c.automatic ? 'requested and therefore automatically approved' : 'approved'} the ${c.kind} trip ${c.route} for ${c.traveller}. The travel desk books it next.`,
  email: (c) => mjml`
    <mj-text font-size="18px" font-weight="600">Approved – ready to book</mj-text>
    <mj-text>${c.automatic ? `${c.approver} requested this trip as the approver, so it was approved automatically.` : `${c.approver} approved this trip.`} The travel desk books it next.</mj-text>
    ${factsBlock(c)}
    ${mutedLine('Comment', c.comment)}`,
  link: (c) => requestLink(c),
  preview: { ...PREVIEW_BASE, approver: 'Max Manager', comment: 'Have a good trip.', automatic: false },
});
