import { z } from 'zod';
import { mjml } from '@/infra/mail/mjml';
import { defineNotification } from '@/modules/core/notifications/notification-template';
import { facts, participationContextSchema, participationLink, PREVIEW_PARTICIPATION } from './training-mail.helpers';

/** SPEC §7 `training.cancellation_rejected`: reject_cancellation -> attendee (cc requester). */
export const cancellationRejectedNotification = defineNotification({
  id: 'training.cancellation_rejected',
  module: 'training',
  description: 'The training office rejected the cancellation; the participation stays as it was.',
  schema: participationContextSchema.extend({ reason: z.string(), state: z.string() }),
  subject: (c) => `Cancellation not possible: ${c.topic}`,
  body: (c) => `The participation stays "${c.state}": ${c.reason}`,
  email: (c) => mjml`
    <mj-text font-size="18px" font-weight="600">${c.topic} cannot be cancelled</mj-text>
    ${facts([
      ['Attendee', c.attendee],
      ['Dates', c.dates],
      ['Status', c.state],
      ['Reason', c.reason],
    ])}`,
  link: participationLink,
  preview: { ...PREVIEW_PARTICIPATION, reason: 'The cancellation period has passed.', state: 'Booked' },
});
