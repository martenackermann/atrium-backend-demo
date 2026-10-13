import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../support/test-app';

describe('GET /api/v1/health', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ seed: [] });
  });

  afterAll(async () => {
    await t?.close();
  });

  it('reports database, queue and mail as up (public, no token)', async () => {
    const res = await t.http().get('/api/v1/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', checks: { database: 'up', queue: 'up', mail: 'up' } });
    expect(res.headers['x-request-id']).toMatch(/^[\w-]+$/);
  });

  it('echoes a client supplied request id', async () => {
    const res = await t.http().get('/api/v1/health').set('X-Request-Id', 'client-abc-123').expect(200);
    expect(res.headers['x-request-id']).toBe('client-abc-123');
  });

  it('sets security headers and allows only configured CORS origins', async () => {
    const res = await t.http().get('/api/v1/health').set('Origin', 'http://localhost:3000');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    const denied = await t.http().get('/api/v1/health').set('Origin', 'http://evil.example.com');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});
