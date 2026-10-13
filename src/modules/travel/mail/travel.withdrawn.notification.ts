import { z } from 'zod';
import { mjml } from '@/infra/mail/mjml';
import { defineNotification } from '@/modules/core/notifications/notification-template';
import { factsBlock, mutedLine, PREVIEW_BASE, requestLink, travelMailBaseSchema } from './travel-mail.helpers';

/** SPEC §7 `travel.withdrawn`: withdraw while pending; to the approver. */
export const travelWithdrawn = defineNotification({
  id: 'travel.withdrawn',
  module: 'travel',
  description: 'A pending trip was withdrawn - no decision needed any more.',
  schema: travelMailBaseSchema.extend({ actor: z.string(), reason: z.string().nullable() }),
  subject: (c) => `Withdrawn: ${c.traveller} – ${c.route}`,
  body: (c) =>
    `${c.actor} withdrew the ${c.kind} trip ${c.route}. No decision is needed any more.${c.reason ? ` Reason: ${c.reason}` : ''}`,
  email: (c) => mjml`
    <mj-text font-size="18px" font-weight="600">Request withdrawn</mj-text>
    <mj-text>${c.actor} withdrew this trip. No decision is needed any more.</mj-text>
    ${factsBlock(c)}
    ${mutedLine('Reason', c.reason)}`,
  link: (c) => requestLink(c),
  preview: { ...PREVIEW_BASE, actor: 'Emma Employee', reason: 'The customer visit moved to next month.' },
});
