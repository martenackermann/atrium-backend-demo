import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../support/test-app';

describe('auth, personas and /me', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  it('logs in with email + demo1234 and returns token + Me', async () => {
    const res = await t
      .http()
      .post('/api/v1/auth/login')
      .send({ email: 'Emma.Employee@example.com', password: 'demo1234' })
      .expect(200);
    expect(res.body).toMatchObject({
      tokenType: 'Bearer',
      accessToken: expect.any(String),
      expiresAt: expect.stringMatching(/Z$/),
      user: {
        email: 'emma.employee@example.com',
        displayName: 'Emma Employee',
        firstName: 'Emma',
        lastName: 'Employee',
        initials: 'EE',
        jobTitle: 'Service Coordinator',
        roles: ['employee'],
        isManager: false,
        isExecutive: false,
        isSiteManager: false,
        personaKey: 'emma',
        department: { code: 'FLD', name: 'Field Services' },
        site: { code: 'RIV', name: 'Riverton' },
        costCenter: { code: 'CC-2100' },
        manager: { displayName: 'Max Manager', initials: 'MM' },
        activeDeputyFor: [],
        active: true,
      },
    });
  });

  it('rejects wrong passwords, unknown emails and inactive users with 401 invalid_credentials', async () => {
    for (const body of [
      { email: 'emma.employee@example.com', password: 'wrong' },
      { email: 'nobody@example.com', password: 'demo1234' },
    ]) {
      const res = await t.http().post('/api/v1/auth/login').send(body).expect(401);
      expect(res.body).toMatchObject({ code: 'invalid_credentials', status: 401 });
    }
    const inactive = await t.prisma.user.findFirstOrThrow({ where: { active: false } });
    await t.http().post('/api/v1/auth/login').send({ email: inactive.email, password: 'demo1234' }).expect(401);
  });

  it('validates the login body (422)', async () => {
    const res = await t.http().post('/api/v1/auth/login').send({ email: 'x@example.com' }).expect(422);
    expect(res.body.errors.password).toBeDefined();
  });

  it('lists the 9 personas in SPEC order (public, DEMO_MODE)', async () => {
    const res = await t.http().get('/api/v1/auth/personas').expect(200);
    expect(res.body.map((p: { key: string }) => p.key)).toEqual([
      'emma',
      'max',
      'sofia',
      'clara',
      'tom',
      'tina',
      'arne',
      'paula',
      'ian',
    ]);
    expect(res.body[1]).toMatchObject({
      key: 'max',
      displayName: 'Max Manager',
      email: 'max.manager@example.com',
      department: 'Field Services',
      roles: ['employee', 'manager'],
      tagline: expect.any(String),
    });
    expect(res.body[7].roles).toEqual(['employee', 'people_ops', 'news_editor']);
  });

  it('demo-login signs in by persona key; unknown keys are 422', async () => {
    const res = await t.http().post('/api/v1/auth/demo-login').send({ personaKey: 'clara' }).expect(200);
    expect(res.body.user).toMatchObject({
      personaKey: 'clara',
      isExecutive: true,
      roles: ['employee', 'manager', 'executive'],
    });
    await t.http().post('/api/v1/auth/demo-login').send({ personaKey: 'nobody' }).expect(422);
  });

  it('GET /me shows derived roles and active deputy assignments', async () => {
    const max = await t.login('max');
    const me = await t.http().get('/api/v1/me').set('Authorization', max).expect(200);
    expect(me.body.roles).toEqual(['employee', 'manager']);
    expect(me.body.isManager).toBe(true);
    expect(me.body.activeDeputyFor).toEqual([
      {
        principal: expect.objectContaining({ displayName: 'Priya Raman' }),
        validFrom: expect.any(String),
        validTo: expect.any(String),
      },
    ]);

    const sofia = await t.login('sofia');
    const sofiaMe = await t.http().get('/api/v1/me').set('Authorization', sofia).expect(200);
    expect(sofiaMe.body).toMatchObject({ isSiteManager: true, isManager: true, activeDeputyFor: [] }); // S-D2 starts d+7
  });

  it('logout revokes the session', async () => {
    const token = await t.login('tom');
    await t.http().get('/api/v1/me').set('Authorization', token).expect(200);
    await t.http().post('/api/v1/auth/logout').set('Authorization', token).expect(204);
    const res = await t.http().get('/api/v1/me').set('Authorization', token).expect(401);
    expect(res.body.code).toBe('unauthenticated');
  });
});
