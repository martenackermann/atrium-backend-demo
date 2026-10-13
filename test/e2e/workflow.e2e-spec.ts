import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixturesModule } from '../support/fixtures.module';
import { createTestApp, type TestApp } from '../support/test-app';

/**
 * End-to-end workflow test with the test-only toy machine (test/support/fixtures.module.ts):
 * HTTP action endpoint -> WorkflowService -> audit_logs + notification outbox, all in one
 * transaction, plus availableActions per user.
 */
describe('workflow actions over HTTP (test-only machine)', () => {
  let t: TestApp;
  let emma: string;
  let max: string;
  let tom: string;

  beforeAll(async () => {
    t = await createTestApp({ imports: [FixturesModule] });
    [emma, max, tom] = await Promise.all([t.login('emma'), t.login('max'), t.login('tom')]);
  });

  afterAll(async () => {
    await t?.close();
  });

  const createToy = async () =>
    (await t.http().post('/api/v1/test-fixtures/toys').set('Authorization', emma).expect(201)).body as {
      id: string;
      status: string;
      availableActions: string[];
    };
  const act = (auth: string, id: string, action: string, body?: object) =>
    t
      .http()
      .post(`/api/v1/test-fixtures/toys/${id}/actions/${action}`)
      .set('Authorization', auth)
      .send(body ?? {});

  it('submits, records audit + notification, and recomputes availableActions', async () => {
    const toy = await createToy();
    expect(toy).toMatchObject({ status: 'draft', state: 'draft', availableActions: ['submit'] });

    const res = await act(emma, toy.id, 'submit').expect(201);
    expect(res.body).toMatchObject({ status: 'submitted', availableActions: ['withdraw'] });
    const asMax = await t.http().get(`/api/v1/test-fixtures/toys/${toy.id}`).set('Authorization', max).expect(200);
    expect(asMax.body.availableActions).toEqual(['approve', 'decline']);

    const audit = await t.prisma.auditLog.findMany({ where: { entityId: toy.id } });
    expect(audit).toEqual([
      expect.objectContaining({
        module: 'core',
        entityType: 'toy_request',
        action: 'submit',
        fromState: 'draft',
        toState: 'submitted',
        actingAs: 'self',
      }),
    ]);
    expect(audit[0].correlationId).toBe(res.headers['x-request-id']);

    const email = await t.prisma.emailMessage.findFirstOrThrow({ where: { entityId: toy.id } });
    expect(email).toMatchObject({
      templateId: 'test.toy_event',
      priority: 'high',
      subject: expect.stringMatching(/^\[High priority\] Toy/),
    });
    const inApp = await t.prisma.notification.findFirstOrThrow({ where: { entityId: toy.id } });
    expect(inApp).toMatchObject({ userId: await t.userId('emma'), priority: 'high', link: `/toys/${toy.id}` });
  });

  it('answers 404 / 403 / 409 / 422 with problem+json', async () => {
    const toy = await createToy();
    // invisible to Tom (not owner, not manager) -> 404
    expect((await act(tom, toy.id, 'submit').expect(404)).body.code).toBe('not_found');
    // unknown action -> 404
    expect((await act(emma, toy.id, 'explode').expect(404)).body.code).toBe('not_found');
    // Max can see it but may not submit someone else's toy -> 403
    expect((await act(max, toy.id, 'submit').expect(403)).body.code).toBe('forbidden');
    // Max may decide, but not in draft -> 409 invalid_transition
    const conflict = await act(max, toy.id, 'approve').expect(409);
    expect(conflict.body).toMatchObject({
      code: 'invalid_transition',
      type: 'https://atrium.example.com/problems/invalid_transition',
      detail: "Action 'approve' is not available in state 'draft'.",
    });
    await act(emma, toy.id, 'submit').expect(201);
    // invalid body -> 422 (reason too short; unknown key)
    expect((await act(max, toy.id, 'decline', { reason: 'no' }).expect(422)).body.errors.reason).toBeDefined();
    await act(max, toy.id, 'approve', { bogus: true }).expect(422);

    const declined = await act(max, toy.id, 'decline', { reason: 'Not this quarter' }).expect(201);
    expect(declined.body).toMatchObject({ status: 'declined', reason: 'Not this quarter', availableActions: [] });
    const audit = await t.prisma.auditLog.findFirstOrThrow({ where: { entityId: toy.id, action: 'decline' } });
    expect(audit).toMatchObject({ actingAs: 'approver', reason: 'Not this quarter', actorId: await t.userId('max') });
    // the owner may not act any more
    await act(emma, toy.id, 'withdraw').expect(409);
  });
});
