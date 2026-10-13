import { z } from 'zod';
import { mjml } from '@/infra/mail/mjml';
import { defineNotification } from '@/modules/core/notifications/notification-template';
import { facts, note, participationContextSchema, PREVIEW_PARTICIPATION } from './training-mail.helpers';

/** SPEC §7 `training.approval_requested`: enters pending_manager_approval -> approver (cc active deputies). */
export const approvalRequestedNotification = defineNotification({
  id: 'training.approval_requested',
  module: 'training',
  description: 'A participation needs the manager-step decision.',
  schema: participationContextSchema.extend({
    approver: z.string(),
    requester: z.string(),
    cost: z.string(),
    escalationNote: z.string().nullable(),
    executiveNote: z.string().nullable(),
  }),
  subject: (c) => `Approval needed: ${c.attendee} – ${c.topic}`,
  body: (c) =>
    `${c.attendee} asks to attend ${c.topic} (${c.dates}, ${c.cost}).${c.escalationNote ? ` ${c.escalationNote}` : ''}`,
  email: (c) => mjml`
    <mj-text font-size="18px" font-weight="600">${c.attendee} asks to attend ${c.topic}</mj-text>
    ${facts([
      ['Training', `${c.topic} (${c.reference})`],
      ['Provider', c.provider],
      ['Dates', c.dates],
      ['Cost per attendee', c.cost],
      ['Requested by', c.requester],
    ])}
    ${note(c.escalationNote)}
    ${note(c.executiveNote)}
    <mj-text>Approve or decline it in Atrium. Your active deputies get a copy of this email.</mj-text>`,
  link: (c) => `/training/approvals?tab=approvals&selected=${c.attendeeId}`,
  preview: {
    ...PREVIEW_PARTICIPATION,
    attendee: 'Hillford technician',
    approver: 'Max Manager',
    requester: 'Sofia Site-Manager',
    cost: '€1,450',
    escalationNote: 'Escalated to you because Sofia Site-Manager is a site manager.',
    executiveNote: null,
  },
});
