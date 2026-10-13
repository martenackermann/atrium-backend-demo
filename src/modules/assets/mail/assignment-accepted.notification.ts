import { z } from 'zod';
import { mjml } from '@/infra/mail/mjml';
import { defineNotification } from '@/modules/core/notifications/notification-template';

/** SPEC §7 `assets.assignment_accepted`: accept -> it-support mailbox. */
export const assignmentAcceptedNotification = defineNotification({
  id: 'assets.assignment_accepted',
  module: 'assets',
  description: 'The assigned user accepted a device.',
  schema: z.object({
    userName: z.string(),
    assetTag: z.string(),
    model: z.string(),
    platform: z.string().nullable(),
    costCenter: z.string(),
    assetId: z.uuid(),
  }),
  subject: (c) => `${c.userName} accepted ${c.assetTag}`,
  body: (c) =>
    `${c.userName} accepted ${c.model} (${c.assetTag})${c.platform ? ` with ${c.platform}` : ''}. Cost centre: ${c.costCenter}.`,
  email: (c) => mjml`
    <mj-text>${c.userName} accepted <b>${c.model}</b> (${c.assetTag}).</mj-text>
    <mj-text>Installed platform: ${c.platform ?? 'not applicable'}<br/>Cost centre: ${c.costCenter}</mj-text>`,
  link: (c) => `/back-office/assets/inventory/${c.assetId}`,
  preview: {
    userName: 'Emma Employee',
    assetTag: 'AST-00118',
    model: 'Vireo Pro 14',
    platform: 'Strata OS 15',
    costCenter: 'CC-2100 Field Services Riverton',
    assetId: '00000000-0000-7000-8000-000000000000',
  },
});
