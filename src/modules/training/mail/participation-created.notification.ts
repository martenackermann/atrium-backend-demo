import { z } from 'zod';
import { mjml } from '@/infra/mail/mjml';
import { defineNotification } from '@/modules/core/notifications/notification-template';
import { facts, participationContextSchema, participationLink, PREVIEW_PARTICIPATION } from './training-mail.helpers';

/** SPEC §7 `training.participation_created`: attendee created -> attendee (cc requester if different). */
export const participationCreatedNotification = defineNotification({
  id: 'training.participation_created',
  module: 'training',
  description: 'A participation was registered for the attendee.',
  schema: participationContextSchema.extend({
    requester: z.string(),
    nextStep: z.string(),
    approver: z.string().nullable(),
    approverReason: z.string().nullable(),
  }),
  subject: (c) => `You're registered for ${c.topic}`,
  body: (c) => `${c.reference} · ${c.dates} · ${c.provider}. ${c.nextStep}`,
  email: (c) => mjml`
    <mj-text font-size="18px" font-weight="600">${c.attendee} is registered for ${c.topic}</mj-text>
    ${facts([
      ['Training', `${c.topic} (${c.reference})`],
      ['Provider', c.provider],
      ['Dates', c.dates],
      ['Requested by', c.requester],
      ['Approver', c.approver ? `${c.approver}${c.approverReason ? ` · ${c.approverReason}` : ''}` : null],
    ])}
    <mj-text>${c.nextStep}</mj-text>`,
  link: participationLink,
  preview: {
    ...PREVIEW_PARTICIPATION,
    requester: 'Emma Employee',
    nextStep: 'Max Manager decides next.',
    approver: 'Max Manager',
    approverReason: 'Direct manager',
  },
});
