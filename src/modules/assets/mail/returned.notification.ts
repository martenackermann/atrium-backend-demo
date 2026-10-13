import { z } from 'zod';
import { mjml, raw } from '@/infra/mail/mjml';
import { defineNotification } from '@/modules/core/notifications/notification-template';

/** SPEC §7 `assets.returned`: return -> the user who returned the device. */
export const returnedNotification = defineNotification({
  id: 'assets.returned',
  module: 'assets',
  description: 'An asset admin confirmed that a device was returned.',
  schema: z.object({
    userName: z.string(),
    assetTag: z.string(),
    model: z.string(),
    condition: z.enum(['ok', 'damaged']),
    note: z.string().nullable(),
  }),
  subject: (c) => `Return confirmed: ${c.assetTag}`,
  body: (c) =>
    `IT support has ${c.model} (${c.assetTag}) back${c.condition === 'damaged' ? '. It was damaged and goes to repair' : ' in good condition'}. It is no longer assigned to you.`,
  email: (c) => mjml`
    <mj-text font-size="18px" font-weight="600">Hello ${c.userName},</mj-text>
    <mj-text>IT support has <b>${c.model}</b> (${c.assetTag}) back. It is no longer assigned to you.</mj-text>
    <mj-text>Condition: ${c.condition === 'damaged' ? 'damaged (sent to repair)' : 'OK'}</mj-text>
    ${c.note ? raw(mjml`<mj-text color="#57524A">Note: ${c.note}</mj-text>`) : ''}`,
  link: () => '/assets',
  preview: {
    userName: 'Max Manager',
    assetTag: 'AST-00042',
    model: 'Tessaract Workbook 14',
    condition: 'ok',
    note: null,
  },
});
