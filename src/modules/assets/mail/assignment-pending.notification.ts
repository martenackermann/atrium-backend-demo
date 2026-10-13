import { z } from 'zod';
import { mjml, raw } from '@/infra/mail/mjml';
import { defineNotification } from '@/modules/core/notifications/notification-template';

/** SPEC §7 `assets.assignment_pending`: assign -> assigned user. */
export const assignmentPendingNotification = defineNotification({
  id: 'assets.assignment_pending',
  module: 'assets',
  description: 'An asset admin assigned a device; the user must accept or decline it.',
  schema: z.object({
    userName: z.string(),
    deviceType: z.string(),
    model: z.string(),
    assetTag: z.string(),
    serialNumber: z.string(),
    assignedBy: z.string(),
    note: z.string().nullable(),
    dueDate: z.string(),
    assetId: z.uuid(),
  }),
  subject: (c) => `Confirm your new ${c.deviceType}`,
  body: (c) =>
    `${c.assignedBy} assigned ${c.model} (${c.assetTag}, serial ${c.serialNumber}) to you. Accept or decline it by ${c.dueDate}.`,
  email: (c) => mjml`
    <mj-text font-size="18px" font-weight="600">Hello ${c.userName},</mj-text>
    <mj-text>${c.assignedBy} assigned a new ${c.deviceType} to you. Accept it once you have it, or decline it if something is wrong.</mj-text>
    <mj-table>
      <tr><td style="padding:4px 12px 4px 0;color:#57524A">Model</td><td>${c.model}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#57524A">Asset tag</td><td>${c.assetTag}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#57524A">Serial number</td><td>${c.serialNumber}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#57524A">Accept by</td><td>${c.dueDate}</td></tr>
    </mj-table>
    ${c.note ? raw(mjml`<mj-text color="#57524A">Note from ${c.assignedBy}: ${c.note}</mj-text>`) : ''}`,
  link: (c) => `/assets/${c.assetId}`,
  preview: {
    userName: 'Emma Employee',
    deviceType: 'laptop',
    model: 'Vireo Pro 14',
    assetTag: 'AST-00118',
    serialNumber: 'VRC4KQ7T2M',
    assignedBy: 'Arne Assets',
    note: 'Your old laptop can stay with you until the data is moved.',
    dueDate: '2026-10-19',
    assetId: '00000000-0000-7000-8000-000000000000',
  },
});
