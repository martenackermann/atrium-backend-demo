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

/**
 * SPEC §7 `training.cancellation_confirmed`: -> cancelled (confirm) -> attendee (cc requester).
 * Also used when the training office closes a booking-impossible participation (SPEC_RESOLUTIONS #11).
 */
export const cancellationConfirmedNotification = defineNotification({
  id: 'training.cancellation_confirmed',
  module: 'training',
  description: 'The participation is cancelled.',
  schema: participationContextSchema.extend({ comment: z.string().nullable() }),
  subject: (c) => `Cancelled: ${c.topic}`,
  body: (c) => `${c.topic} (${c.dates}) is cancelled.${c.comment ? ` ${c.comment}` : ''}`,
  email: (c) => mjml`
    <mj-text font-size="18px" font-weight="600">${c.topic} is cancelled</mj-text>
    ${facts([
      ['Attendee', c.attendee],
      ['Dates', c.dates],
    ])}
    ${note(c.comment)}`,
  link: participationLink,
  preview: { ...PREVIEW_PARTICIPATION, comment: 'The provider refunds the fee.' },
});
