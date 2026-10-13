import { z } from 'zod';
import { mjml } from '@/infra/mail/mjml';
import { defineNotification } from '@/modules/core/notifications/notification-template';
import { facts, participationContextSchema, participationLink, PREVIEW_PARTICIPATION } from './training-mail.helpers';

/** SPEC §7 `training.participation_withdrawn`: withdraw -> pending approver (cc attendee, requester). */
export const participationWithdrawnNotification = defineNotification({
  id: 'training.participation_withdrawn',
  module: 'training',
  description: 'A pending participation was withdrawn; no decision is needed any more.',
  schema: participationContextSchema.extend({ withdrawnBy: z.string(), reason: z.string().nullable() }),
  subject: (c) => `Withdrawn: ${c.attendee} – ${c.topic}`,
  body: (c) => `${c.withdrawnBy} withdrew the request.${c.reason ? ` Reason: ${c.reason}` : ''} No decision is needed.`,
  email: (c) => mjml`
    <mj-text font-size="18px" font-weight="600">${c.attendee} – ${c.topic} was withdrawn</mj-text>
    ${facts([
      ['Training', `${c.topic} (${c.reference})`],
      ['Dates', c.dates],
      ['Withdrawn by', c.withdrawnBy],
      ['Reason', c.reason],
    ])}
    <mj-text>No decision is needed any more.</mj-text>`,
  link: participationLink,
  preview: { ...PREVIEW_PARTICIPATION, withdrawnBy: 'Emma Employee', reason: 'Found an internal course instead.' },
});
