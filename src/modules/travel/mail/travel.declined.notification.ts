import { z } from 'zod';
import { mjml } from '@/infra/mail/mjml';
import { defineNotification } from '@/modules/core/notifications/notification-template';
import { factsBlock, PREVIEW_BASE, requestLink, travelMailBaseSchema } from './travel-mail.helpers';

/** SPEC §7 `travel.declined`: → declined; to traveller, cc requester. */
export const travelDeclined = defineNotification({
  id: 'travel.declined',
  module: 'travel',
  description: 'The approver declined a trip.',
  schema: travelMailBaseSchema.extend({ decider: z.string(), reason: z.string() }),
  subject: (c) => `Travel request declined: ${c.route}`,
  body: (c) => `${c.decider} declined the ${c.kind} trip ${c.route}: ${c.reason}`,
  email: (c) => mjml`
    <mj-text font-size="18px" font-weight="600">Travel request declined</mj-text>
    <mj-text>${c.decider} declined this trip.</mj-text>
    ${factsBlock(c)}
    <mj-text>Reason: ${c.reason}</mj-text>
    <mj-text color="#6b7785">You can duplicate the request in Atrium, adjust it and submit it again.</mj-text>`,
  link: (c) => requestLink(c),
  preview: { ...PREVIEW_BASE, decider: 'Max Manager', reason: 'Standard class is sufficient for this trip.' },
});
