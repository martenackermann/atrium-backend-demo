import { z } from 'zod';
import { defineMailTemplate, mjml } from '../mail-template';

/** Foundation template used to check the mail pipeline end to end. */
export const systemTestMail = defineMailTemplate({
  name: 'system.test',
  description: 'Pipeline check: confirms that queued mail reaches the inbox.',
  schema: z.object({ recipientName: z.string(), actionUrl: z.url() }),
  subject: () => 'Atrium test message',
  preheader: (data) => `Hello ${data.recipientName}, the mail pipeline works.`,
  body: (data) => mjml`
    <mj-text font-size="18px" font-weight="600">Hello ${data.recipientName},</mj-text>
    <mj-text>This is a test message from Atrium. If you can read it, queued mail is rendered and delivered correctly.</mj-text>
    <mj-button href="${data.actionUrl}">Open Atrium</mj-button>`,
  preview: { recipientName: 'Emma Employee', actionUrl: 'http://localhost:3000/' },
});
