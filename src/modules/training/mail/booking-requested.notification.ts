import { z } from 'zod';
import { mjml } from '@/infra/mail/mjml';
import { defineNotification } from '@/modules/core/notifications/notification-template';
import { facts, participationContextSchema, PREVIEW_PARTICIPATION } from './training-mail.helpers';

/** SPEC §7 `training.booking_requested`: -> to_book -> training-office mailbox. */
export const bookingRequestedNotification = defineNotification({
  id: 'training.booking_requested',
  module: 'training',
  description: 'An approved participation is ready to be booked.',
  schema: participationContextSchema.extend({
    requester: z.string(),
    registrationUrl: z.string().nullable(),
    registrationDetails: z.string().nullable(),
    hotel: z.string().nullable(),
    approval: z.string(),
  }),
  subject: (c) => `To book: ${c.topic} – ${c.attendee}`,
  body: (c) => `${c.attendee} · ${c.provider} · ${c.dates}. ${c.approval}`,
  email: (c) => mjml`
    <mj-text font-size="18px" font-weight="600">Book ${c.topic} for ${c.attendee}</mj-text>
    ${facts([
      ['Training', `${c.topic} (${c.reference})`],
      ['Provider', c.provider],
      ['Dates', c.dates],
      ['Requested by', c.requester],
      ['Approval', c.approval],
      ['Registration link', c.registrationUrl],
      ['Registration details', c.registrationDetails],
      ['Hotel', c.hotel],
    ])}`,
  link: (c) => `/back-office/training?queue=to_book&selected=${c.attendeeId}`,
  preview: {
    ...PREVIEW_PARTICIPATION,
    requester: 'Emma Employee',
    registrationUrl: 'https://training.example.com/masterclass',
    registrationDetails: 'Group code ACME-26',
    hotel: 'Mon 2 Nov – Wed 4 Nov',
    approval: 'Approved by Max Manager',
  },
});
