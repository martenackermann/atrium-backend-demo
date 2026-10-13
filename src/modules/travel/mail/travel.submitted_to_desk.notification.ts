import { z } from 'zod';
import { mjml } from '@/infra/mail/mjml';
import { defineNotification } from '@/modules/core/notifications/notification-template';
import { factsBlock, mutedLine, PREVIEW_BASE, requestLink, travelMailBaseSchema } from './travel-mail.helpers';

/** SPEC §7 `travel.submitted_to_desk`: → to_book without approval; travel-desk mailbox, cc traveller. */
export const travelSubmittedToDesk = defineNotification({
  id: 'travel.submitted_to_desk',
  module: 'travel',
  description: 'A trip without an approval step is ready to book.',
  schema: travelMailBaseSchema.extend({ requester: z.string(), exemption: z.string().nullable() }),
  subject: (c) => `To book: ${c.kind} ${c.route} for ${c.traveller}`,
  body: (c) =>
    `The ${c.kind} trip ${c.route} (${c.when}) needs no approval${c.exemption ? ` (${c.exemption})` : ''} and goes straight to the travel desk.`,
  email: (c) => mjml`
    <mj-text font-size="18px" font-weight="600">Ready to book</mj-text>
    <mj-text>${c.requester} submitted a trip that needs no approval. The travel desk books it next.</mj-text>
    ${factsBlock(c)}
    ${mutedLine('No approval needed', c.exemption)}`,
  link: (c) => requestLink(c),
  preview: {
    ...PREVIEW_BASE,
    kind: 'train',
    route: 'Riverton Central → Hillford Central',
    requester: 'Emma Employee',
    exemption: null,
  },
});
