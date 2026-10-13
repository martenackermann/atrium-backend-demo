import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixturesModule } from '../support/fixtures.module';
import { createTestApp, type TestApp } from '../support/test-app';

const PROBLEM = /^application\/problem\+json/;
const TYPE = (code: string) => `https://atrium.example.com/problems/${code}`;

describe('HTTP conventions', () => {
  let t: TestApp;
  let emma: string;
  let ian: string;

  beforeAll(async () => {
    t = await createTestApp({ imports: [FixturesModule] });
    emma = await t.login('emma');
    ian = await t.login('ian');
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('422 validation_failed', () => {
    it('returns field errors keyed by dot path, with code and traceId', async () => {
      const res = await t
        .http()
        .post('/api/v1/test-fixtures/things')
        .send({ title: 'ab', quantity: 0, contact: { email: 'nope' } })
        .expect(422);

      expect(res.headers['content-type']).toMatch(PROBLEM);
      expect(res.body).toMatchObject({
        type: TYPE('validation_failed'),
        title: 'Validation failed',
        status: 422,
        code: 'validation_failed',
        instance: '/api/v1/test-fixtures/things',
        errors: { title: [expect.any(String)], quantity: [expect.any(String)], 'contact.email': [expect.any(String)] },
      });
      expect(res.body.traceId).toBe(res.headers['x-request-id']);
    });

    it('rejects unknown keys (strict bodies) and reports missing fields as "Required"', async () => {
      const res = await t
        .http()
        .post('/api/v1/test-fixtures/things')
        .send({ quantity: 1, contact: { email: 'a@example.com' }, extra: true })
        .expect(422);
      expect(res.body.errors.title).toEqual(['Required']);
      expect(res.body.errors._root).toEqual([expect.stringContaining('extra')]);
    });

    it('passes valid payloads through', async () => {
      const body = { title: 'Laptop', quantity: 2, contact: { email: 'emma.employee@example.com' } };
      await t.http().post('/api/v1/test-fixtures/things').send(body).expect(201).expect(body);
    });
  });

  describe('pagination and sorting', () => {
    it('applies defaults (perPage 25)', async () => {
      const res = await t.http().get('/api/v1/test-fixtures/things').expect(200);
      expect(res.body.meta).toEqual({ page: 1, perPage: 25, total: 45, totalPages: 2 });
      expect(res.body.sort).toEqual([{ field: 'createdAt', direction: 'desc' }]);
    });

    it('parses page, perPage and multi-field sort; a page beyond the end is empty', async () => {
      const res = await t
        .http()
        .get('/api/v1/test-fixtures/things?page=3&perPage=10&sort=title,-createdAt')
        .expect(200);
      expect(res.body.meta).toEqual({ page: 3, perPage: 10, total: 45, totalPages: 5 });
      expect(res.body.data[0]).toEqual({ id: 21 });
      const beyond = await t.http().get('/api/v1/test-fixtures/things?page=9').expect(200);
      expect(beyond.body.data).toEqual([]);
    });

    it('rejects perPage above 100 and unknown sort fields', async () => {
      const res = await t.http().get('/api/v1/test-fixtures/things?perPage=101&sort=password').expect(422);
      expect(Object.keys(res.body.errors).sort()).toEqual(['perPage', 'sort']);
    });
  });

  describe('401 / 403 / 404', () => {
    it('401 unauthenticated without or with a bad token', async () => {
      const res = await t.http().get('/api/v1/me').expect(401);
      expect(res.headers['content-type']).toMatch(PROBLEM);
      expect(res.body).toMatchObject({ type: TYPE('unauthenticated'), code: 'unauthenticated', status: 401 });
      await t.http().get('/api/v1/me').set('Authorization', 'Bearer not-a-jwt').expect(401);
    });

    it('public routes still see a valid token', async () => {
      await t.http().get('/api/v1/test-fixtures/maybe-me').expect(200, { userId: null });
      const res = await t.http().get('/api/v1/test-fixtures/maybe-me').set('Authorization', emma).expect(200);
      expect(res.body.userId).toBe(await t.userId('emma'));
    });

    it('403 forbidden from @CheckAbility; allowed by an @AbilityRules provider', async () => {
      const res = await t.http().get('/api/v1/test-fixtures/secret').set('Authorization', emma).expect(403);
      expect(res.body).toMatchObject({ type: TYPE('forbidden'), code: 'forbidden' });
      await t.http().get('/api/v1/test-fixtures/secret').set('Authorization', ian).expect(200, { secret: 'demo' });
    });

    it('404 not_found for unknown routes and malformed ids', async () => {
      const res = await t.http().get('/api/v1/does-not-exist').set('Authorization', emma).expect(404);
      expect(res.body).toMatchObject({ code: 'not_found', status: 404, instance: '/api/v1/does-not-exist' });
      await t.http().get('/api/v1/users/not-a-uuid').set('Authorization', emma).expect(404);
    });
  });

  describe('Idempotency-Key', () => {
    it('replays the first response for the same key and body', async () => {
      const key = 'b3f1c2d4-0000-4000-8000-000000000001';
      const post = (auth: string, value: string) =>
        t
          .http()
          .post('/api/v1/test-fixtures/echo')
          .set('Authorization', auth)
          .set('Idempotency-Key', key)
          .send({ value });

      const first = await post(emma, 'x').expect(201);
      const replay = await post(emma, 'x').expect(201);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(replay.body).toEqual(first.body);

      const reused = await post(emma, 'other').expect(422);
      expect(reused.body.code).toBe('idempotency_key_reused');

      // keys are per user
      const other = await post(ian, 'x').expect(201);
      expect(other.body.execution).toBe(first.body.execution + 1);
    });
  });

  describe('OpenAPI', () => {
    it('serves the document at /api/openapi.json and Swagger UI at /api/docs', async () => {
      const res = await t.http().get('/api/openapi.json').expect(200);
      expect(res.body.info.title).toBe('Atrium API');
      expect(res.body.paths['/api/v1/health'].get.security).toEqual([]);
      expect(res.body.paths['/api/v1/auth/login'].post.security).toEqual([]);
      expect(res.body.paths['/api/v1/me'].get.security).toBeUndefined();
      expect(res.body.components.schemas.ProblemDetails).toBeDefined();
      const ui = await t.http().get('/api/docs').redirects(1).expect(200);
      expect(ui.text).toContain('swagger');
    });
  });
});
