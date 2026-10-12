import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixturesModule } from '../support/fixtures.module';
import { createTestApp, type TestApp } from '../support/test-app';

const PROBLEM = /^application\/problem\+json/;

describe('HTTP conventions', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ imports: [FixturesModule] });
  });

  afterAll(async () => {
    await t?.close();
  });

  describe('validation (422 problem+json)', () => {
    it('returns field errors keyed by dotted path', async () => {
      const res = await t
        .http()
        .post('/api/v1/test-fixtures/things')
        .send({ title: 'ab', quantity: 0, contact: { email: 'nope' } })
        .expect(422);

      expect(res.headers['content-type']).toMatch(PROBLEM);
      expect(res.body).toMatchObject({
        type: 'https://atrium.example.com/problems/validation-error',
        title: 'Validation failed',
        status: 422,
        instance: '/api/v1/test-fixtures/things',
        errors: {
          title: [expect.any(String)],
          quantity: [expect.any(String)],
          'contact.email': [expect.any(String)],
        },
      });
      expect(res.body.requestId).toBe(res.headers['x-request-id']);
    });

    it('reports missing fields as "Required"', async () => {
      const res = await t.http().post('/api/v1/test-fixtures/things').send({}).expect(422);
      expect(res.body.errors.title).toEqual(['Required']);
    });

    it('passes valid payloads through', async () => {
      const body = { title: 'Laptop', quantity: 2, contact: { email: 'emma.employee@example.com' } };
      await t.http().post('/api/v1/test-fixtures/things').send(body).expect(201).expect(body);
    });
  });

  describe('pagination and sorting', () => {
    it('applies defaults', async () => {
      const res = await t.http().get('/api/v1/test-fixtures/things').expect(200);
      expect(res.body.meta).toEqual({ page: 1, perPage: 20, total: 45, totalPages: 3 });
      expect(res.body.data).toHaveLength(20);
      expect(res.body.sort).toEqual([{ field: 'createdAt', direction: 'desc' }]);
    });

    it('parses page, perPage and multi-field sort', async () => {
      const res = await t
        .http()
        .get('/api/v1/test-fixtures/things?page=3&perPage=10&sort=title,-createdAt')
        .expect(200);
      expect(res.body.meta).toEqual({ page: 3, perPage: 10, total: 45, totalPages: 5 });
      expect(res.body.data[0]).toEqual({ id: 21 });
      expect(res.body.sort).toEqual([
        { field: 'title', direction: 'asc' },
        { field: 'createdAt', direction: 'desc' },
      ]);
    });

    it('rejects perPage above 100 and unknown sort fields', async () => {
      const res = await t.http().get('/api/v1/test-fixtures/things?perPage=101&sort=password').expect(422);
      expect(Object.keys(res.body.errors).sort()).toEqual(['perPage', 'sort']);
      expect(res.body.errors.sort[0]).toContain('Allowed: title, createdAt');
    });
  });

  describe('authentication and authorization', () => {
    it('requires a bearer token by default (401 problem)', async () => {
      const res = await t.http().get('/api/v1/test-fixtures/me').expect(401);
      expect(res.headers['content-type']).toMatch(PROBLEM);
      expect(res.body.type).toBe('https://atrium.example.com/problems/unauthorized');
    });

    it('rejects invalid tokens', async () => {
      await t.http().get('/api/v1/test-fixtures/me').set('Authorization', 'Bearer not-a-jwt').expect(401);
    });

    it('accepts a valid token and exposes the user', async () => {
      const auth = await t.bearer({ id: 'u-1', roles: ['employee'] });
      const res = await t.http().get('/api/v1/test-fixtures/me').set('Authorization', auth).expect(200);
      expect(res.body).toEqual({ id: 'u-1', email: 'u-1@example.com', roles: ['employee'] });
    });

    it('lets public routes see an optional user', async () => {
      await t.http().get('/api/v1/test-fixtures/maybe-me').expect(200, { user: null });
      const auth = await t.bearer({ id: 'u-2' });
      const res = await t.http().get('/api/v1/test-fixtures/maybe-me').set('Authorization', auth).expect(200);
      expect(res.body.user.id).toBe('u-2');
    });

    it('enforces @CheckAbility with rules from @AbilityRules providers', async () => {
      await t.http().get('/api/v1/test-fixtures/secret').expect(401);
      const employee = await t.bearer({ id: 'u-3', roles: ['employee'] });
      const forbidden = await t.http().get('/api/v1/test-fixtures/secret').set('Authorization', employee).expect(403);
      expect(forbidden.body.type).toBe('https://atrium.example.com/problems/forbidden');
      const admin = await t.bearer({ id: 'u-4', roles: ['admin'] });
      await t.http().get('/api/v1/test-fixtures/secret').set('Authorization', admin).expect(200, { secret: 'demo' });
    });
  });

  describe('errors', () => {
    it('renders unknown routes as 404 problem+json', async () => {
      const auth = await t.bearer({ id: 'u-5' });
      const res = await t.http().get('/api/v1/does-not-exist').set('Authorization', auth).expect(404);
      expect(res.headers['content-type']).toMatch(PROBLEM);
      expect(res.body).toMatchObject({ status: 404, title: 'Not Found', instance: '/api/v1/does-not-exist' });
    });
  });

  describe('OpenAPI', () => {
    it('serves the document at /docs/openapi.json', async () => {
      const res = await t.http().get('/docs/openapi.json').expect(200);
      expect(res.body.info.title).toBe('Atrium API');
      expect(res.body.paths['/api/v1/health'].get.security).toEqual([]);
      expect(res.body.paths['/api/v1/test-fixtures/me'].get.security).toBeUndefined();
      expect(res.body.components.schemas.ProblemDetails).toBeDefined();
      const listParams = res.body.paths['/api/v1/test-fixtures/things'].get.parameters.map(
        (p: { name: string }) => p.name,
      );
      expect(listParams).toEqual(expect.arrayContaining(['page', 'perPage', 'sort']));
    });

    it('serves Swagger UI at /docs', async () => {
      const res = await t.http().get('/docs').redirects(1).expect(200);
      expect(res.text).toContain('swagger');
    });
  });
});
