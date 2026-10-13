import { z } from 'zod';
import { mjml } from '@/infra/mail/mjml';
import { defineNotification } from '@/modules/core/notifications/notification-template';
import { facts, participationContextSchema, participationLink, PREVIEW_PARTICIPATION } from './training-mail.helpers';

/** SPEC §7 `training.participation_declined`: -> declined -> attendee (cc requester). */
export const participationDeclinedNotification = defineNotification({
  id: 'training.participation_declined',
  module: 'training',
  description: 'The participation was declined.',
  schema: participationContextSchema.extend({ decider: z.string(), reason: z.string() }),
  subject: (c) => `Declined: ${c.topic}`,
  body: (c) => `${c.decider} declined: ${c.reason}`,
  email: (c) => mjml`
    <mj-text font-size="18px" font-weight="600">${c.topic} was declined</mj-text>
    ${facts([
      ['Attendee', c.attendee],
      ['Dates', c.dates],
      ['Declined by', c.decider],
      ['Reason', c.reason],
    ])}`,
  link: participationLink,
  preview: {
    ...PREVIEW_PARTICIPATION,
    topic: 'Presentation Skills',
    decider: 'Max Manager',
    reason: 'Please join the internal session in Q1 instead.',
  },
});
