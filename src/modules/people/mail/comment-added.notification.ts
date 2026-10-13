import { z } from 'zod';
import { mjml } from '@/infra/mail/mjml';
import { defineNotification, truncate } from '@/modules/core/notifications/notification-template';

/**
 * SPEC §7 `people.comment_added`: public comment -> the other party (requester <-> assignee,
 * or the people-ops mailbox when unassigned); manager comments go to requester + People Ops
 * (SPEC_RESOLUTIONS #19). Internal comments never notify.
 */
export const peopleCommentAddedNotification = defineNotification({
  id: 'people.comment_added',
  module: 'people',
  description: 'Someone commented on a people request.',
  schema: z.object({
    requestId: z.uuid(),
    reference: z.string(),
    title: z.string(),
    authorName: z.string(),
    excerpt: z.string(),
  }),
  subject: (c) => `New comment on ${c.reference}`,
  body: (c) => `${c.authorName} on ${c.title}: ${truncate(c.excerpt, 300)}`,
  email: (c) => mjml`
    <mj-text font-size="18px" font-weight="600">${c.reference} · ${c.title}</mj-text>
    <mj-text>${c.authorName} wrote:</mj-text>
    <mj-text font-style="italic">${truncate(c.excerpt, 300)}</mj-text>`,
  link: (c) => `/people-requests/${c.requestId}`,
  preview: {
    requestId: '00000000-0000-7000-8000-000000000000',
    reference: 'PPL-000004',
    title: 'Access to the dispatch planning board',
    authorName: 'Emma Employee',
    excerpt: 'Riverton and Westbay, from November on.',
  },
});
