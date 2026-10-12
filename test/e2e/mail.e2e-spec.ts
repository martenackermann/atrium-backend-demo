import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAIL_SEND_JOB, MailService } from '@/infra/mail/mail.service';
import { systemTestMail } from '@/infra/mail/templates/system-test.mail';
import { QueueService } from '@/infra/queue/queue.service';
import { createTestApp, type TestApp } from '../support/test-app';

const MAILPIT_API = process.env.TEST_MAILPIT_API ?? 'http://localhost:8025/api/v1';

interface MailpitSearch {
  messages: { Subject: string; To: { Address: string }[] }[];
}

describe('mail pipeline (queue -> MJML -> SMTP/Mailpit)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  it('delivers a queued template mail', async () => {
    const to = `mail-test-${randomUUID()}@example.com`;
    const spy = t.app.get(QueueService).spy<{ to: string[] }>(MAIL_SEND_JOB);
    const completed = spy.waitForJob((job) => job.to.includes(to), 'completed');

    await t.app.get(MailService).send(systemTestMail, {
      to,
      data: { recipientName: 'Test Person', actionUrl: 'http://localhost:3000/' },
    });
    await completed;

    const res = await fetch(`${MAILPIT_API}/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const found = (await res.json()) as MailpitSearch;
    expect(found.messages).toHaveLength(1);
    expect(found.messages[0]?.Subject).toBe('Atrium test message');
  });

  it('validates template data before queueing', async () => {
    await expect(
      t.app.get(MailService).send(systemTestMail, {
        to: 'x@example.com',
        data: { recipientName: 'X', actionUrl: 'not a url' },
      }),
    ).rejects.toThrow();
  });

  it('renders the dev preview route', async () => {
    const list = await t.http().get('/api/v1/dev/mail-preview').expect(200);
    expect(list.body.templates.map((x: { name: string }) => x.name)).toContain('system.test');
    const html = await t.http().get('/api/v1/dev/mail-preview/system.test').expect(200);
    expect(html.text).toContain('Atrium');
    expect(html.text).toContain('Acme IT Services · demo');
  });
});
