import { z } from 'zod';
import { mjml } from '@/infra/mail/mjml';
import { defineNotification } from '@/modules/core/notifications/notification-template';
import { factsBlock, KIND_NOUN, PREVIEW_BASE, requestLink, travelMailBaseSchema } from './travel-mail.helpers';

/** SPEC §7 `travel.created_for_you`: requester ≠ traveller; to the traveller. */
export const travelCreatedForYou = defineNotification({
  id: 'travel.created_for_you',
  module: 'travel',
  description: 'Someone requested a trip for the recipient.',
  schema: travelMailBaseSchema.extend({ requester: z.string() }),
  subject: (c) => `${c.requester} requested a ${KIND_NOUN[c.kind]} for you`,
  body: (c) => `${c.requester} requested a ${KIND_NOUN[c.kind]} for you: ${c.route} (${c.when}).`,
  email: (c) => mjml`
    <mj-text font-size="18px" font-weight="600">A trip was requested for you</mj-text>
    <mj-text>${c.requester} requested a ${KIND_NOUN[c.kind]} for you. We will let you know when it is approved and booked.</mj-text>
    ${factsBlock(c)}`,
  link: (c) => requestLink(c),
  preview: { ...PREVIEW_BASE, requester: 'Max Manager' },
});
