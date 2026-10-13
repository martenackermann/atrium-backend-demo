import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../support/test-app';

/**
 * Integration: with every module seeded, the persona stories of SPEC §2.3 / §10 show up across
 * modules in `/me/inbox`, `/me/inbox/counts` and `/home/my-day`.
 */
describe('integrated my-day and inbox (all modules seeded)', () => {
  let t: TestApp;
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    t = await createTestApp({ seed: ['core', 'training', 'travel', 'assets', 'people', 'news'] });
    for (const persona of ['emma', 'max', 'clara', 'tom', 'tina', 'paula', 'arne', 'ian'] as const)
      tokens[persona] = await t.login(persona);
  });

  afterAll(async () => {
    await t?.close();
  });

  const get = (persona: string, path: string) =>
    t.http().get(`/api/v1${path}`).set('Authorization', tokens[persona]!).expect(200);
  /** `/me/inbox` and `/search` answer `{ data: [...] }`. */
  const list = async (persona: string, path: string) => (await get(persona, path)).body.data;
  const types = (items: { type: string }[]) => items.map((i) => i.type).sort();

  it('Emma: ratings, goals, two devices to accept and a question to answer; trips coming up', async () => {
    const inbox = await list('emma', '/me/inbox');
    expect(types(inbox)).toEqual([
      'assets.acceptance_required',
      'assets.acceptance_required',
      'people.reply_required',
      'training.goals_missing',
      'training.rating_due',
      'training.rating_due',
    ]);
    const counts = await get('emma', '/me/inbox/counts');
    expect(counts.body).toMatchObject({ training: 3, travel: 0, assets: 2, people: 1, total: 6 });

    const day = await get('emma', '/home/my-day');
    expect(day.body.inbox.total).toBe(6);
    expect(day.body.assets).toMatchObject({ pendingAcceptance: 2 });
    const modules = new Set(day.body.upcoming.map((u: { module: string }) => u.module));
    expect(modules).toEqual(new Set(['training', 'travel']));
    expect(day.body.news.length).toBeGreaterThan(0);
  });

  it('Max: training and travel approvals (own reports, escalated, as deputy for Priya)', async () => {
    const items = (await list('max', '/me/inbox')) as {
      type: string;
      subtitle: string;
      quickActions: string[];
      actionsPath: string;
    }[];
    expect(items.filter((i) => i.type === 'training.approval_required').length).toBeGreaterThanOrEqual(5);
    expect(items.filter((i) => i.type === 'travel.approval_required').length).toBeGreaterThanOrEqual(4);
    expect(items.some((i) => i.subtitle.includes('for Priya Raman'))).toBe(true);
    for (const item of items.filter((i) => i.type.endsWith('approval_required'))) {
      expect(item.quickActions).toEqual(['approve', 'decline']);
      expect(item.actionsPath).toMatch(/^\/(training\/participations|travel\/requests)\/[0-9a-f-]{36}$/);
    }
  });

  it('Clara: executive training approvals and a travel approval', async () => {
    const inbox = await list('clara', '/me/inbox');
    const subtitles = (inbox as { type: string; subtitle: string }[])
      .filter((i) => i.type === 'training.approval_required')
      .map((i) => i.subtitle);
    expect(subtitles.filter((s) => s.includes('executive step'))).toHaveLength(3);
    expect(types(inbox)).toContain('travel.approval_required');
  });

  it('back offices get their queues; Arne and Ian get no inbox items (API.md §8)', async () => {
    const tom = await list('tom', '/me/inbox');
    expect(new Set(types(tom))).toEqual(new Set(['travel.booking_required', 'travel.cancellation_review']));
    const tina = await list('tina', '/me/inbox');
    expect(new Set(types(tina))).toEqual(new Set(['training.booking_required', 'training.cancellation_review']));
    const paula = await list('paula', '/me/inbox');
    expect(new Set(types(paula))).toEqual(new Set(['people.triage_required']));
    expect(await list('arne', '/me/inbox')).toEqual([]);
    expect(await list('ian', '/me/inbox')).toEqual([]);
  });

  it('search finds records across modules for the back office', async () => {
    const hits = await list('tom', '/search?q=Riverton');
    const modules = new Set((hits as { module: string }[]).map((hit) => hit.module));
    expect(modules.has('travel')).toBe(true);
  });
});
