import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock } from '@/common/time/clock.service';
import { createTestApp, type TestApp } from '../support/test-app';

/** `GET /home/my-day` (API.md §7.4) composed from the inbox and the my-day contributors. */
describe('home my-day', () => {
  let t: TestApp;
  let emma: string;
  let paula: string;

  beforeAll(async () => {
    t = await createTestApp({ seed: ['core', 'people', 'news'] });
    [emma, paula] = await Promise.all([t.login('emma'), t.login('paula')]);
  });

  afterAll(async () => {
    await t?.close();
  });

  it('composes the day for Emma', async () => {
    const res = await t.http().get('/api/v1/home/my-day').set('Authorization', emma).expect(200);
    expect(res.body).toMatchObject({
      date: t.app.get(Clock).today(),
      inbox: { total: 1, high: 0, top: [expect.objectContaining({ type: 'people.reply_required' })] },
      upcoming: [],
      assets: null,
    });
    expect(res.body.news.map((n: { title: string }) => n.title)).toEqual([
      'Welcome to Atrium',
      'Travel desk hours during the holidays',
      'Atrium update: deputies with validity windows',
    ]);
    expect(res.body.news[0].coverImage.url).toContain('/api/v1/files/');
    expect(res.body.links).toHaveLength(9);
    expect(res.body.links.every((l: { active: boolean }) => l.active)).toBe(true);
  });

  it('caps the inbox head at five and keeps the inbox order', async () => {
    const res = await t.http().get('/api/v1/home/my-day').set('Authorization', paula).expect(200);
    expect(res.body.inbox.total).toBe(3);
    expect(res.body.inbox.high).toBe(1);
    expect(res.body.inbox.top[0]).toMatchObject({ reference: 'PPL-000008', priority: 'high' });
    expect(res.body.inbox.top.length).toBeLessThanOrEqual(5);
  });

  it('requires a session', async () => {
    await t.http().get('/api/v1/home/my-day').expect(401);
  });
});
