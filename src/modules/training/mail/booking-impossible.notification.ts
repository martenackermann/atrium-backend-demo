import { z } from 'zod';
import { mjml } from '@/infra/mail/mjml';
import { defineNotification } from '@/modules/core/notifications/notification-template';
import { facts, participationContextSchema, participationLink, PREVIEW_PARTICIPATION } from './training-mail.helpers';

/** SPEC §7 `training.booking_impossible`: -> booking_impossible -> attendee (cc requester). */
export const bookingImpossibleNotification = defineNotification({
  id: 'training.booking_impossible',
  module: 'training',
  description: 'The training office could not book the participation.',
  schema: participationContextSchema.extend({ reason: z.string() }),
  subject: (c) => `Booking not possible: ${c.topic}`,
  body: (c) => `The training office could not book ${c.topic}: ${c.reason}`,
  email: (c) => mjml`
    <mj-text font-size="18px" font-weight="600">${c.topic} could not be booked</mj-text>
    ${facts([
      ['Attendee', c.attendee],
      ['Dates', c.dates],
      ['Reason', c.reason],
    ])}
    <mj-text>The training office may retry the booking. You can also withdraw the request in Atrium.</mj-text>`,
  link: participationLink,
  preview: { ...PREVIEW_PARTICIPATION, reason: 'Provider fully booked until next quarter' },
});
