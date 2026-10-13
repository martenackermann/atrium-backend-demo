import { z } from 'zod';
import { mjml } from '@/infra/mail/mjml';
import { defineNotification } from '@/modules/core/notifications/notification-template';
import { facts, participationContextSchema, PREVIEW_PARTICIPATION } from './training-mail.helpers';

/** SPEC §7 `training.executive_approval_requested`: enters pending_executive_approval -> executive (cc deputies). */
export const executiveApprovalRequestedNotification = defineNotification({
  id: 'training.executive_approval_requested',
  module: 'training',
  description: 'A participation at or above the threshold needs the executive decision.',
  schema: participationContextSchema.extend({
    cost: z.string(),
    threshold: z.string(),
    managerDecision: z.string(),
  }),
  subject: (c) => `Executive approval needed (≥ ${c.threshold}): ${c.topic}`,
  body: (c) => `${c.attendee} · ${c.dates} · ${c.cost}. ${c.managerDecision}`,
  email: (c) => mjml`
    <mj-text font-size="18px" font-weight="600">Executive approval for ${c.attendee}</mj-text>
    <mj-text>Trainings from ${c.threshold} per attendee also need an executive decision.</mj-text>
    ${facts([
      ['Training', `${c.topic} (${c.reference})`],
      ['Provider', c.provider],
      ['Dates', c.dates],
      ['Cost per attendee', c.cost],
      ['Manager step', c.managerDecision],
    ])}`,
  link: (c) => `/training/approvals?tab=executive&selected=${c.attendeeId}`,
  preview: {
    ...PREVIEW_PARTICIPATION,
    topic: 'Cloud Architecture Bootcamp',
    cost: '€6,900',
    threshold: '€5,000',
    managerDecision: 'Approved by Victor Lang.',
  },
});
