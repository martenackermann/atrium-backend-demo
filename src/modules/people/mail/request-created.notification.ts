import { z } from 'zod';
import { mjml } from '@/infra/mail/mjml';
import { defineNotification } from '@/modules/core/notifications/notification-template';

/**
 * SPEC §7 `people.request_created`: create -> people-ops mailbox, cc requester + manager.
 * Never contains personal data.
 */
export const peopleRequestCreatedNotification = defineNotification({
  id: 'people.request_created',
  module: 'people',
  description: 'A new onboarding, offboarding or role change request was created.',
  schema: z.object({
    requestId: z.uuid(),
    reference: z.string(),
    typeLabel: z.string(),
    title: z.string(),
    effectiveDate: z.string(),
    effectiveLabel: z.string(),
    priorityLabel: z.string(),
    requesterName: z.string(),
    subjectName: z.string(),
  }),
  subject: (c) => `New ${c.typeLabel.toLowerCase()} request: ${c.title}`,
  body: (c) =>
    `${c.requesterName} requested ${c.typeLabel.toLowerCase()} for ${c.subjectName} (${c.reference}). ${c.effectiveLabel}: ${c.effectiveDate}. Priority: ${c.priorityLabel}.`,
  email: (c) => mjml`
    <mj-text font-size="18px" font-weight="600">${c.reference} · ${c.title}</mj-text>
    <mj-text>${c.requesterName} requested <b>${c.typeLabel.toLowerCase()}</b> for ${c.subjectName}.</mj-text>
    <mj-table>
      <tr><td style="padding:4px 12px 4px 0;color:#57524A">Type</td><td>${c.typeLabel}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#57524A">${c.effectiveLabel}</td><td>${c.effectiveDate}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#57524A">Priority</td><td>${c.priorityLabel}</td></tr>
    </mj-table>
    <mj-text>Personal data is visible only in Atrium.</mj-text>`,
  link: (c) => `/people-requests/${c.requestId}`,
  preview: {
    requestId: '00000000-0000-7000-8000-000000000000',
    reference: 'PPL-000001',
    typeLabel: 'Onboarding',
    title: 'Field Technician – Hillford',
    effectiveDate: 'Tue 27 Oct',
    effectiveLabel: 'Start date',
    priorityLabel: 'High',
    requesterName: 'Max Manager',
    subjectName: 'Jordan Reyes',
  },
});
