import '../support/low-rate-limit-env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixturesModule } from '../support/fixtures.module';
import { createTestApp, type TestApp } from '../support/test-app';

describe('rate limit on /api/v1/auth/*', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ imports: [FixturesModule] });
  });

  afterAll(async () => {
    await t?.close();
  });

  it('answers 429 problem+json once the per-minute limit is used up', async () => {
    for (let i = 0; i < 3; i++) await t.http().get('/api/v1/auth/test-ping').expect(200);
    const res = await t.http().get('/api/v1/auth/test-ping').expect(429);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.body.type).toBe('https://atrium.example.com/problems/rate-limited');
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('does not limit other routes', async () => {
    for (let i = 0; i < 5; i++) await t.http().get('/api/v1/health').expect(200);
  });
});
