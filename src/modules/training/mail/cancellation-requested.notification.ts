import { z } from 'zod';
import { mjml } from '@/infra/mail/mjml';
import { defineNotification } from '@/modules/core/notifications/notification-template';
import { facts, participationContextSchema, PREVIEW_PARTICIPATION } from './training-mail.helpers';

/** SPEC §7 `training.cancellation_requested`: -> cancellation_requested -> training-office mailbox (cc attendee). */
export const cancellationRequestedNotification = defineNotification({
  id: 'training.cancellation_requested',
  module: 'training',
  description: 'The attendee or requester asks to cancel an approved participation.',
  schema: participationContextSchema.extend({
    requestedBy: z.string(),
    reason: z.string(),
    previousState: z.string(),
  }),
  subject: (c) => `Cancellation requested: ${c.topic} – ${c.attendee}`,
  body: (c) => `${c.requestedBy} asks to cancel (${c.previousState}): ${c.reason}`,
  email: (c) => mjml`
    <mj-text font-size="18px" font-weight="600">Cancellation requested for ${c.attendee}</mj-text>
    ${facts([
      ['Training', `${c.topic} (${c.reference})`],
      ['Dates', c.dates],
      ['Status before', c.previousState],
      ['Requested by', c.requestedBy],
      ['Reason', c.reason],
    ])}
    <mj-text>Confirm or reject the cancellation in Atrium.</mj-text>`,
  link: (c) => `/back-office/training?queue=cancellations&selected=${c.attendeeId}`,
  preview: {
    ...PREVIEW_PARTICIPATION,
    requestedBy: 'Emma Employee',
    reason: 'Shift conflict with on-call duty',
    previousState: 'Booked',
  },
});
