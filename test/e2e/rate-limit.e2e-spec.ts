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

  it('gives the secret-less demo login 10x the limit (long demo and e2e sessions)', async () => {
    const demo = () => t.http().post('/api/v1/auth/demo-login').send({ personaKey: 'emma' });
    for (let i = 0; i < 30; i++) expect((await demo()).status).not.toBe(429); // no seed: 404, never 429
    expect((await demo().expect(429)).body.code).toBe('rate_limited');
  });

  it('shares the budget across path variants Express routes to the login handler', async () => {
    const attempt = (path: string) =>
      t.http().post(path).send({ email: 'variant@example.com', password: 'wrong-pass' });
    await attempt('/api/v1/auth/login').expect(401);
    await attempt('/api/v1/auth/login/').expect(401);
    await attempt('/api/v1/AUTH/LOGIN').expect(401);
    for (const path of ['/api/v1/auth/login', '/api/v1/auth/login/', '/api/v1/Auth/Login']) {
      expect((await attempt(path).expect(429)).body.code).toBe('rate_limited');
    }
  });

  it('ignores X-Forwarded-For from untrusted clients (TRUST_PROXY=false)', async () => {
    const attempt = (ip: string) =>
      t
        .http()
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email: 'spoofer@example.com', password: 'wrong-pass' });
    for (let i = 1; i <= 3; i++) await attempt(`203.0.113.${i}`).expect(401);
    await attempt('203.0.113.99').expect(429);
  });

  it('tracks emails separately and leaves other routes alone', async () => {
    await t.http().post('/api/v1/auth/login').send({ email: 'someone-else@example.com', password: 'x' }).expect(401);
    for (let i = 0; i < 5; i++) await t.http().get('/api/v1/health').expect(200);
  });
});
