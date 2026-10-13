import { z } from 'zod';
import { mjml, raw } from '@/infra/mail/mjml';
import { defineNotification } from '@/modules/core/notifications/notification-template';
import { factsBlock, PREVIEW_BASE, travelMailBaseSchema } from './travel-mail.helpers';

/** SPEC §7 `travel.approval_requested`: → pending_approval; to approver, cc the approver's active deputies. */
export const travelApprovalRequested = defineNotification({
  id: 'travel.approval_requested',
  module: 'travel',
  description: 'A travel request waits for the approver.',
  schema: travelMailBaseSchema.extend({
    reasons: z.array(z.string()),
    approver: z.string(),
    requester: z.string(),
    /** Skipped site manager (escalation note), if any. */
    escalatedFrom: z.string().nullable(),
  }),
  subject: (c) => `Travel approval needed: ${c.traveller} – ${c.kind} ${c.route}`,
  body: (c) =>
    `${c.traveller} asks for a ${c.kind} trip ${c.route} (${c.when}). Needs approval because: ${c.reasons.join(', ')}.`,
  email: (c) => mjml`
    <mj-text font-size="18px" font-weight="600">Your approval is needed</mj-text>
    <mj-text>${c.requester === c.traveller ? c.traveller : `${c.requester} (for ${c.traveller})`} submitted a travel request for ${c.approver} to decide.</mj-text>
    ${factsBlock(c)}
    <mj-text font-weight="600" padding="10px 0 2px">Needs approval because</mj-text>
    ${c.reasons.map((reason) => raw(mjml`<mj-text padding="0">${reason}</mj-text>`))}
    ${
      c.escalatedFrom
        ? raw(
            mjml`<mj-text color="#6b7785" padding="10px 0 0">Escalated to ${c.approver} because ${c.escalatedFrom} is a site manager.</mj-text>`,
          )
        : ''
    }`,
  link: (c) => `/travel/approvals?tab=approvals&selected=${c.requestId}`,
  preview: {
    ...PREVIEW_BASE,
    reasons: ['Automatic transmission (guaranteed)', 'Foreign travel'],
    approver: 'Max Manager',
    requester: 'Emma Employee',
    escalatedFrom: null,
  },
});
