import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../support/test-app';

describe('GET /api/v1/health', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  it('reports database and queue as up', async () => {
    const res = await t.http().get('/api/v1/health').expect(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      checks: { database: { status: 'up' }, queue: { status: 'up' } },
    });
    expect(res.headers['x-request-id']).toMatch(/^[\w-]+$/);
  });

  it('echoes a client supplied request id', async () => {
    const res = await t.http().get('/api/v1/health').set('X-Request-Id', 'client-abc-123').expect(200);
    expect(res.headers['x-request-id']).toBe('client-abc-123');
  });

  it('sets security headers (helmet)', async () => {
    const res = await t.http().get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('allows the configured CORS origin only', async () => {
    const allowed = await t.http().get('/api/v1/health').set('Origin', 'http://localhost:3000');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    const denied = await t.http().get('/api/v1/health').set('Origin', 'http://evil.example.com');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});
