import { z } from 'zod';
import { mjml, raw } from '@/infra/mail/mjml';
import { defineNotification } from '@/modules/core/notifications/notification-template';
import { factsBlock, mutedLine, PREVIEW_BASE, requestLink, travelMailBaseSchema } from './travel-mail.helpers';

/**
 * SPEC §7 `travel.booked`: → booked; to traveller, cc requester + companions. The
 * confirmation PDFs are attached; the PIN is never sent by email (D12).
 */
export const travelBooked = defineNotification({
  id: 'travel.booked',
  module: 'travel',
  description: 'The travel desk booked a trip (confirmations attached, PIN only in Atrium).',
  schema: travelMailBaseSchema.extend({
    bookingNumber: z.string(),
    hasPin: z.boolean(),
    comment: z.string().nullable(),
    attachmentCount: z.number().int(),
  }),
  subject: (c) => `Booked: ${c.kind} ${c.route}`,
  body: (c) =>
    `The ${c.kind} trip ${c.route} is booked. Booking number ${c.bookingNumber}.${c.hasPin ? ' The PIN is available in Atrium.' : ''}`,
  email: (c) => mjml`
    <mj-text font-size="18px" font-weight="600">Your trip is booked</mj-text>
    ${factsBlock(c)}
    <mj-text>Booking number: <b>${c.bookingNumber}</b></mj-text>
    ${c.hasPin ? raw(mjml`<mj-text>A PIN is available in Atrium. For your security it is never sent by email.</mj-text>`) : ''}
    ${
      c.attachmentCount > 0
        ? raw(
            mjml`<mj-text color="#6b7785">${c.attachmentCount === 1 ? 'The booking confirmation is attached.' : `${c.attachmentCount} booking confirmations are attached.`}</mj-text>`,
          )
        : ''
    }
    ${mutedLine('Note from the travel desk', c.comment)}`,
  link: (c) => requestLink(c),
  preview: {
    ...PREVIEW_BASE,
    kind: 'flight',
    route: 'Riverton Airport → Northport Airport',
    bookingNumber: 'QX7H2L',
    hasPin: true,
    comment: null,
    attachmentCount: 1,
  },
});
