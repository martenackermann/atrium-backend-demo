import { mjml } from '@/infra/mail/mjml';
import { defineNotification } from '@/modules/core/notifications/notification-template';
import { facts, participationContextSchema, participationLink, PREVIEW_PARTICIPATION } from './training-mail.helpers';

/** SPEC §7 `training.goals_reminder`: goals-reminder job -> attendee. */
export const goalsReminderNotification = defineNotification({
  id: 'training.goals_reminder',
  module: 'training',
  description: 'Reminder to write down two learning goals before the training starts.',
  schema: participationContextSchema,
  subject: (c) => `Set your learning goals for ${c.topic}`,
  body: (c) => `${c.topic} starts ${c.dates}. Write down two learning goals before it starts.`,
  email: (c) => mjml`
    <mj-text font-size="18px" font-weight="600">Two goals for ${c.topic}</mj-text>
    ${facts([
      ['Training', `${c.topic} (${c.reference})`],
      ['Dates', c.dates],
    ])}
    <mj-text>What should be different after the training? Two short sentences are enough. Your manager sees them next to your feedback later.</mj-text>`,
  link: (c) => `${participationLink(c)}#goals`,
  preview: { ...PREVIEW_PARTICIPATION, topic: 'First Aid at Work Refresher' },
});
