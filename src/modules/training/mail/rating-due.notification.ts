import { z } from 'zod';
import { mjml } from '@/infra/mail/mjml';
import { defineNotification } from '@/modules/core/notifications/notification-template';
import { facts, participationContextSchema, PREVIEW_PARTICIPATION } from './training-mail.helpers';

const ROUND: Record<1 | 2 | 3, string> = { 1: 'Your feedback', 2: 'Putting it into practice', 3: "Manager's view" };

/** SPEC §7 `training.rating_due`: rating-reminder job -> rater (each reminder). */
export const ratingDueNotification = defineNotification({
  id: 'training.rating_due',
  module: 'training',
  description: 'A feedback round (rating loop 1, 2 or 3) is due.',
  schema: participationContextSchema.extend({
    ratingId: z.uuid(),
    loop: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    dueDate: z.string(),
    reminder: z.number().int(),
    reminderMax: z.number().int(),
  }),
  subject: (c) =>
    c.loop === 1
      ? `How was ${c.topic}?`
      : c.loop === 2
        ? `Putting ${c.topic} into practice`
        : `Your view on ${c.attendee}'s progress after ${c.topic}`,
  body: (c) =>
    `Feedback round ${c.loop} of 3 (${ROUND[c.loop as 1 | 2 | 3]}) is due since ${c.dueDate}. Reminder ${c.reminder} of ${c.reminderMax}.`,
  email: (c) => mjml`
    <mj-text font-size="18px" font-weight="600">Feedback round ${c.loop} of 3: ${ROUND[c.loop as 1 | 2 | 3]}</mj-text>
    ${facts([
      ['Training', `${c.topic} (${c.reference})`],
      ['Attendee', c.attendee],
      ['Dates', c.dates],
      ['Due since', c.dueDate],
      ['Reminder', `${c.reminder} of ${c.reminderMax}`],
    ])}
    <mj-text>It takes about two minutes.</mj-text>`,
  link: (c) => `/training/ratings/${c.ratingId}`,
  preview: {
    ...PREVIEW_PARTICIPATION,
    topic: 'Spreadsheet Analysis Essentials',
    ratingId: '0192f1c2-8e4b-7c3a-9d2e-1a2b3c4d5e70',
    loop: 2,
    dueDate: 'Sun 11 Oct',
    reminder: 1,
    reminderMax: 4,
  },
});
