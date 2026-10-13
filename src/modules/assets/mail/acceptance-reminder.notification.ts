import { z } from 'zod';
import { mjml } from '@/infra/mail/mjml';
import { defineNotification } from '@/modules/core/notifications/notification-template';

/** SPEC §7 `assets.acceptance_reminder`: job -> assigned user (high priority from the 2nd reminder). */
export const acceptanceReminderNotification = defineNotification({
  id: 'assets.acceptance_reminder',
  module: 'assets',
  description: 'Reminder to accept or decline a device that is still waiting for acceptance.',
  schema: z.object({
    userName: z.string(),
    deviceType: z.string(),
    model: z.string(),
    assetTag: z.string(),
    assignedOn: z.string(),
    reminder: z.number().int(),
    reminderMax: z.number().int(),
    assetId: z.uuid(),
  }),
  subject: (c) => `Reminder: confirm your ${c.deviceType}`,
  body: (c) =>
    `${c.model} (${c.assetTag}) was assigned to you on ${c.assignedOn} and is still waiting for your confirmation. Reminder ${c.reminder} of ${c.reminderMax}.`,
  email: (c) => mjml`
    <mj-text font-size="18px" font-weight="600">Hello ${c.userName},</mj-text>
    <mj-text>The ${c.deviceType} ${c.model} (${c.assetTag}) was assigned to you on ${c.assignedOn}. Accept it in Atrium, or decline it if you did not receive it.</mj-text>
    <mj-text color="#6F695E">Reminder ${c.reminder} of ${c.reminderMax}.</mj-text>`,
  link: (c) => `/assets/${c.assetId}`,
  preview: {
    userName: 'Emma Employee',
    deviceType: 'smartphone',
    model: 'Marlowe X5 128 GB Midnight',
    assetTag: 'AST-00115',
    assignedOn: '2026-10-09',
    reminder: 2,
    reminderMax: 3,
    assetId: '00000000-0000-7000-8000-000000000000',
  },
});
