import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QueueService } from '@/infra/queue/queue.service';
import {
  MAIL_SEND_JOB,
  type MailSendJob,
  NotificationService,
} from '@/modules/core/notifications/notification.service';
import { FixturesModule, toyEventNotification } from '../support/fixtures.module';
import { createTestApp, type TestApp } from '../support/test-app';

const MAILPIT_API = process.env.TEST_MAILPIT_API ?? 'http://localhost:8025/api/v1';

interface MailpitSearch {
  messages: { ID: string; Subject: string; To: { Address: string }[]; Cc: { Address: string }[] | null }[];
}

describe('notifications: outbox -> mail.send job -> MJML -> SMTP (Mailpit)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ imports: [FixturesModule] });
  });

  afterAll(async () => {
    await t?.close();
  });

  it('delivers to users and mailboxes, writes in-app rows for users only', async () => {
    const queue = t.app.get(QueueService);
    const emmaId = await t.userId('emma');
    const toyId = crypto.randomUUID();
    const result = await t.app.get(NotificationService).send(toyEventNotification, {
      to: [{ userId: emmaId }],
      cc: [{ mailbox: 'travel_desk' }, { userId: await t.userId('max') }],
      context: { toyId, state: 'approved', actorName: 'Max Manager' },
      priority: 'high',
      entity: { type: 'toy_request', id: toyId },
    });
    expect(result.emailMessageId).toBeTruthy();
    expect(result.notificationIds).toHaveLength(2); // Emma + Max (mailbox: email only)

    const completed = queue
      .spy<MailSendJob>(MAIL_SEND_JOB)
      .waitForJob((job) => job.emailMessageId === result.emailMessageId, 'completed');
    await completed;

    const message = await t.prisma.emailMessage.findUniqueOrThrow({ where: { id: result.emailMessageId! } });
    expect(message).toMatchObject({ status: 'sent', attempts: 1, to: ['emma.employee@example.com'] });
    expect(message.cc.sort()).toEqual(['max.manager@example.com', 'travel-desk@example.com']);

    const search = await fetch(`${MAILPIT_API}/search?query=${encodeURIComponent(`subject:"${toyId.slice(0, 8)}"`)}`);
    const found = (await search.json()) as MailpitSearch;
    expect(found.messages).toHaveLength(1);
    expect(found.messages[0]?.Subject).toBe(`[High priority] Toy ${toyId.slice(0, 8)} is now approved`);
    const body = await fetch(`${MAILPIT_API}/message/${found.messages[0].ID}`);
    const html = ((await body.json()) as { HTML: string }).HTML;
    expect(html).toContain('Acme IT Services · demo');
    expect(html).toContain(`http://localhost:3000/toys/${toyId}`);
  });

  it('rejects invalid template context and unregistered templates', async () => {
    const service = t.app.get(NotificationService);
    await expect(
      service.send(toyEventNotification, { to: [{ email: 'x@example.com' }], context: { toyId: 1 } as never }),
    ).rejects.toThrow(/Invalid context/);
    await expect(
      service.send(
        { ...toyEventNotification, id: 'test.unknown' },
        { to: [{ email: 'x@example.com' }], context: toyEventNotification.preview },
      ),
    ).rejects.toThrow(/not registered/);
  });

  it('renders every template in the dev preview route', async () => {
    const list = await t.http().get('/api/v1/dev/mail-preview').expect(200);
    expect(list.body.templates.map((x: { id: string }) => x.id)).toEqual(
      expect.arrayContaining(['core.deputy_assigned', 'test.toy_event']),
    );
    const html = await t.http().get('/api/v1/dev/mail-preview/core.deputy_assigned').expect(200);
    expect(html.text).toContain('Priya Raman named you as their deputy');
    const text = await t
      .http()
      .get('/api/v1/dev/mail-preview/core.deputy_assigned?format=text&priority=high')
      .expect(200);
    expect(text.text).toContain('Subject: [High priority] Priya Raman named you as deputy');
  });
});
