import '../support/demo-mode-off-env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../support/test-app';

describe('DEMO_MODE=false hides the demo-only routes', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  it('answers 404 for the persona list and the persona login, whatever the body', async () => {
    expect((await t.http().get('/api/v1/auth/personas').expect(404)).body.code).toBe('not_found');
    expect((await t.http().post('/api/v1/auth/demo-login').send({ personaKey: 'ian' }).expect(404)).body.code).toBe(
      'not_found',
    );
    // A guard runs before validation: no 422 that would reveal the route.
    await t.http().post('/api/v1/auth/demo-login').send({ nonsense: true }).expect(404);
    const emma = await t.login('emma');
    const config = await t.http().get('/api/v1/meta/config').set('Authorization', emma).expect(200);
    expect(config.body.demoMode).toBe(false);
  });

  it('keeps password login working', async () => {
    await t
      .http()
      .post('/api/v1/auth/login')
      .send({ email: 'emma.employee@example.com', password: 'demo1234' })
      .expect(200);
  });
});
