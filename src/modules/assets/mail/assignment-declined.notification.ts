import { z } from 'zod';
import { mjml } from '@/infra/mail/mjml';
import { defineNotification } from '@/modules/core/notifications/notification-template';

/** SPEC §7 `assets.assignment_declined`: decline -> it-support mailbox. */
export const assignmentDeclinedNotification = defineNotification({
  id: 'assets.assignment_declined',
  module: 'assets',
  description: 'The assigned user declined a device; it is back in stock.',
  schema: z.object({
    userName: z.string(),
    assetTag: z.string(),
    model: z.string(),
    reason: z.string(),
    assetId: z.uuid(),
  }),
  subject: (c) => `${c.userName} declined ${c.assetTag}`,
  body: (c) => `${c.userName} declined ${c.model} (${c.assetTag}): ${c.reason}. The device is back in stock.`,
  email: (c) => mjml`
    <mj-text>${c.userName} declined <b>${c.model}</b> (${c.assetTag}). The device is back in stock.</mj-text>
    <mj-text color="#57524A">Reason: ${c.reason}</mj-text>`,
  link: (c) => `/back-office/assets/inventory/${c.assetId}`,
  preview: {
    userName: 'Emma Employee',
    assetTag: 'AST-00115',
    model: 'Marlowe X5 128 GB Midnight',
    reason: 'I already have a working phone from the field team.',
    assetId: '00000000-0000-7000-8000-000000000000',
  },
});
