import { z } from 'zod';
import { mjml, raw } from '@/infra/mail/mjml';
import { defineNotification } from '@/modules/core/notifications/notification-template';

const STATUS_TEXT: Record<string, string> = {
  in_progress: 'People Ops is working on it.',
  waiting_internal: 'People Ops is waiting on another team and tells you when it moves on.',
  waiting_on_requester: 'People Ops needs your reply before they can continue.',
  reopened: 'The request was reopened.',
  completed: 'The request is complete.',
  rejected: 'The request was rejected.',
  cancelled: 'The request was cancelled.',
};

/**
 * SPEC §7 `people.status_changed`: every transition -> requester, cc manager. The note of
 * `wait_internal` is internal and never part of this mail (SPEC_RESOLUTIONS #19).
 */
export const peopleStatusChangedNotification = defineNotification({
  id: 'people.status_changed',
  module: 'people',
  description: 'A people request moved to another status.',
  schema: z.object({
    requestId: z.uuid(),
    reference: z.string(),
    title: z.string(),
    status: z.string(),
    statusLabel: z.string(),
    actorName: z.string(),
    /** wait_on_requester */
    question: z.string().nullable(),
    /** reject / cancel / reopen */
    reason: z.string().nullable(),
    /** public notes of start_work / resume / complete */
    note: z.string().nullable(),
  }),
  // Sentence case (DESIGN §10): the status label reads lower case inside the sentence.
  subject: (c) => `${c.reference} is now ${c.statusLabel.toLowerCase()}`,
  title: (c) => `${c.reference} is now ${c.statusLabel.toLowerCase()}`,
  body: (c) =>
    [
      `${c.title}: ${STATUS_TEXT[c.status] ?? `Now ${c.statusLabel.toLowerCase()}.`}`,
      c.question ? `Question: ${c.question}` : null,
      c.reason ? `Reason: ${c.reason}` : null,
      c.note ? `Note: ${c.note}` : null,
    ]
      .filter(Boolean)
      .join(' '),
  email: (c) => mjml`
    <mj-text font-size="18px" font-weight="600">${c.reference} · ${c.title}</mj-text>
    <mj-text>${STATUS_TEXT[c.status] ?? `The request is now ${c.statusLabel.toLowerCase()}.`} (${c.actorName})</mj-text>
    ${c.question ? raw(mjml`<mj-text><b>Question:</b> ${c.question}</mj-text><mj-text>Reply in Atrium; your answer moves the request back to People Ops.</mj-text>`) : ''}
    ${c.reason ? raw(mjml`<mj-text><b>Reason:</b> ${c.reason}</mj-text>`) : ''}
    ${c.note ? raw(mjml`<mj-text><b>Note:</b> ${c.note}</mj-text>`) : ''}`,
  link: (c) => `/people-requests/${c.requestId}`,
  preview: {
    requestId: '00000000-0000-7000-8000-000000000000',
    reference: 'PPL-000004',
    title: 'Access to the dispatch planning board',
    status: 'waiting_on_requester',
    statusLabel: 'Waiting on requester',
    actorName: 'Paula People-Ops',
    question: 'Which regions do you need to plan for?',
    reason: null,
    note: null,
  },
});
