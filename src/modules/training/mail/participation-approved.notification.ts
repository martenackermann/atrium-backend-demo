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
 * SPEC §7 `training.participation_approved`: -> to_book via approval -> attendee (cc requester).
 * Also sent for participations approved automatically at creation (SPEC_RESOLUTIONS #28).
 */
export const participationApprovedNotification = defineNotification({
  id: 'training.participation_approved',
  module: 'training',
  description: 'The participation is approved; the training office books it next.',
  schema: participationContextSchema.extend({
    approvedBy: z.string(),
    comment: z.string().nullable(),
  }),
  subject: (c) => `Approved: ${c.topic}`,
  body: (c) => `${c.approvedBy}. The training office books ${c.topic} next.`,
  email: (c) => mjml`
    <mj-text font-size="18px" font-weight="600">${c.topic} is approved</mj-text>
    ${facts([
      ['Attendee', c.attendee],
      ['Dates', c.dates],
      ['Decision', c.approvedBy],
    ])}
    ${note(c.comment ? `Comment: ${c.comment}` : null)}
    <mj-text>The training office books it next and emails the booking details.</mj-text>`,
  link: participationLink,
  preview: { ...PREVIEW_PARTICIPATION, approvedBy: 'Approved by Max Manager', comment: 'Enjoy the course.' },
});
