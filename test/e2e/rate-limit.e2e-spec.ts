import '../support/low-rate-limit-env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../support/test-app';

describe('login rate limit (LOGIN_RATE_LIMIT per 15 min per email + IP)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ seed: [] });
  });

  afterAll(async () => {
    await t?.close();
  });

  it('answers 429 rate_limited with Retry-After once the limit is used up', async () => {
    const attempt = () =>
      t.http().post('/api/v1/auth/login').send({ email: 'nobody@example.com', password: 'wrong-pass' });
    for (let i = 0; i < 3; i++) await attempt().expect(401);
    const res = await attempt().expect(429);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.body).toMatchObject({ code: 'rate_limited', type: 'https://atrium.example.com/problems/rate_limited' });
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('tracks emails separately and leaves other routes alone', async () => {
    await t.http().post('/api/v1/auth/login').send({ email: 'someone-else@example.com', password: 'x' }).expect(401);
    for (let i = 0; i < 5; i++) await t.http().get('/api/v1/health').expect(200);
  });
});
