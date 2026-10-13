import { z } from 'zod';
import { mjml } from '@/infra/mail/mjml';
import { defineNotification } from '@/modules/core/notifications/notification-template';
import {
  facts,
  note,
  participationContextSchema,
  participationLink,
  PREVIEW_PARTICIPATION,
} from './training-mail.helpers';

/** SPEC §7 `training.participation_booked`: -> booked -> attendee (cc requester). */
export const participationBookedNotification = defineNotification({
  id: 'training.participation_booked',
  module: 'training',
  description: 'The training office booked the participation.',
  schema: participationContextSchema.extend({
    bookingReference: z.string().nullable(),
    comment: z.string().nullable(),
    documentCount: z.number().int(),
  }),
  subject: (c) => `Booked: ${c.topic}`,
  body: (c) =>
    `${c.topic} on ${c.dates} is booked${c.bookingReference ? ` (${c.bookingReference})` : ''}. Set two learning goals before it starts.`,
  email: (c) => mjml`
    <mj-text font-size="18px" font-weight="600">${c.topic} is booked</mj-text>
    ${facts([
      ['Attendee', c.attendee],
      ['Provider', c.provider],
      ['Dates', c.dates],
      ['Booking reference', c.bookingReference],
      ['Documents', c.documentCount > 0 ? `${c.documentCount} in Atrium` : null],
    ])}
    ${note(c.comment)}
    <mj-text>Before it starts, write down two learning goals in Atrium. They help you and your manager see what the training changed.</mj-text>`,
  link: (c) => `${participationLink(c)}#goals`,
  preview: { ...PREVIEW_PARTICIPATION, bookingReference: 'BP-48213', comment: null, documentCount: 1 },
});
