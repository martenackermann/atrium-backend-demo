import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NewsService } from '@/modules/news/services/news.service';
import { gradientPng } from '@/modules/news/seed/cover-image';
import { createTestApp, type TestApp } from '../support/test-app';

interface Post {
  id: string;
  title: string;
  status: string;
  pinned: boolean;
  bodyHtml: string;
  publishAt: string | null;
  expireAt: string | null;
  publishedAt: string | null;
  coverImage: { attachmentId: string; url: string; expiresAt: string } | null;
  availableActions: string[];
  version: number;
}

/** News posts and useful links (SPEC §4.6, §5.5, §8; API.md §7.2-7.3). */
describe('news and links', () => {
  let t: TestApp;
  let emma: string;
  let paula: string;
  let ian: string;

  beforeAll(async () => {
    t = await createTestApp({ seed: ['core', 'news'] });
    [emma, paula, ian] = await Promise.all([t.login('emma'), t.login('paula'), t.login('ian')]);
  });

  afterAll(async () => {
    await t?.close();
  });

  const act = (auth: string, id: string, action: string, body: object = {}) =>
    t.http().post(`/api/v1/news/${id}/actions/${action}`).set('Authorization', auth).send(body);
  const draft = async (overrides: object = {}) =>
    (
      await t
        .http()
        .post('/api/v1/news')
        .set('Authorization', paula)
        .send({
          title: 'Canteen opens later',
          type: 'update',
          summary: 'From Monday at 12:00.',
          bodyHtml: '<p>Details.</p>',
          ...overrides,
        })
        .expect(201)
    ).body as Post;
  const idOf = async (title: string) => (await t.prisma.newsPost.findFirstOrThrow({ where: { title } })).id;
  const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

  describe('reading', () => {
    it('shows everyone published posts only, pinned first then newest', async () => {
      const res = await t.http().get('/api/v1/news?status=draft').set('Authorization', emma).expect(200);
      expect(res.body.data.map((p: Post) => p.title)).toEqual([
        'Welcome to Atrium',
        'Travel desk hours during the holidays',
        'Atrium update: deputies with validity windows',
        'Hillford site: new parking arrangement',
      ]);
      const welcome = res.body.data[0] as Post;
      expect(welcome).toMatchObject({ pinned: true, availableActions: [] });
      expect(welcome.coverImage?.url).toContain('/api/v1/files/');
      const cover = await t.http().get(welcome.coverImage!.url.replace('http://localhost:3100', '')).expect(200);
      expect(cover.headers['content-type']).toBe('image/png');
    });

    it('shows editors every post with status filter and actions', async () => {
      const all = await t.http().get('/api/v1/news?perPage=50').set('Authorization', paula).expect(200);
      expect(all.body.meta.total).toBe(8);
      const scheduled = await t.http().get('/api/v1/news?status=scheduled').set('Authorization', paula).expect(200);
      expect(scheduled.body.data.map((p: Post) => p.title).sort()).toEqual([
        'New laptop models in IT stock',
        'Quarterly town hall at Campus',
      ]);
      expect(scheduled.body.data[0].availableActions).toEqual(['publish', 'unschedule', 'edit']);
      const archived = await t.http().get('/api/v1/news?status=archived').set('Authorization', ian).expect(200);
      expect(archived.body.data[0].availableActions).toEqual(['restore', 'delete']);
      await t.http().get('/api/v1/news?sort=title').set('Authorization', paula).expect(422);
    });

    it('returns 404 for unpublished posts to non-editors, and timelines to editors only', async () => {
      const draftId = await idOf('Training budget for next year');
      await t.http().get(`/api/v1/news/${draftId}`).set('Authorization', emma).expect(404);
      await t.http().get(`/api/v1/news/${draftId}`).set('Authorization', paula).expect(200);
      const welcome = await idOf('Welcome to Atrium');
      await t.http().get(`/api/v1/news/${welcome}/timeline`).set('Authorization', emma).expect(403);
      const timeline = await t.http().get(`/api/v1/news/${welcome}/timeline`).set('Authorization', paula).expect(200);
      expect(timeline.body.map((e: { action: string }) => e.action)).toEqual(['create', 'publish']);
    });

    it('finds published news in the command palette', async () => {
      const res = await t.http().get('/api/v1/search?q=town hall').set('Authorization', paula).expect(200);
      expect(res.body.data.filter((h: { module: string }) => h.module === 'news')).toEqual([]);
      const hit = await t.http().get('/api/v1/search?q=parking').set('Authorization', emma).expect(200);
      expect(hit.body.data).toEqual([expect.objectContaining({ module: 'news', type: 'news_post', reference: null })]);
    });
  });

  describe('writing', () => {
    it('creates drafts for editors only, sanitising the body', async () => {
      await t
        .http()
        .post('/api/v1/news')
        .set('Authorization', emma)
        .send({ title: 'Mine', type: 'update', summary: 'x', bodyHtml: '<p>x</p>' })
        .expect(403);
      const res = await t
        .http()
        .post('/api/v1/news')
        .set('Authorization', paula)
        .send({
          title: 'Safety week',
          type: 'information',
          summary: 'Workshops all week.',
          bodyHtml: '<p onclick="steal()">Join <script>alert(1)</script><a href="javascript:alert(1)">us</a></p>',
          pinned: true,
        })
        .expect(201);
      expect(res.headers.location).toBe(`/api/v1/news/${res.body.id}`);
      expect(res.body).toMatchObject({ status: 'draft', pinned: true, bodyHtml: '<p>Join us</p>' });
      expect(res.body.availableActions).toEqual(['publish', 'schedule', 'edit', 'delete']);
      await t
        .http()
        .post('/api/v1/news')
        .set('Authorization', paula)
        .send({ title: 'x', type: 'memo', summary: 'x'.repeat(281), bodyHtml: '', extra: 1 })
        .expect(422);
      const past = await t
        .http()
        .post('/api/v1/news')
        .set('Authorization', paula)
        .send({ title: 'Past', type: 'update', summary: '', bodyHtml: '', expireAt: inMinutes(-5) })
        .expect(422);
      expect(Object.keys(past.body.errors)).toEqual(['expireAt']);
    });

    it('links an uploaded cover image', async () => {
      const upload = await t
        .http()
        .post('/api/v1/attachments')
        .set('Authorization', paula)
        .field('purpose', 'news_cover')
        .attach('file', gradientPng(32, 16), 'cover.png')
        .expect(201);
      await t
        .http()
        .post('/api/v1/attachments')
        .set('Authorization', emma)
        .field('purpose', 'news_cover')
        .attach('file', gradientPng(32, 16), 'cover.png')
        .expect(403);
      const post = await draft({ coverImageId: upload.body.id });
      expect(post.coverImage?.attachmentId).toBe(upload.body.id);
      // Draft covers are invisible to non-editors.
      await t.http().get(`/api/v1/attachments/${upload.body.id}`).set('Authorization', emma).expect(404);
      await act(paula, post.id, 'publish').expect(200);
      await t.http().get(`/api/v1/attachments/${upload.body.id}`).set('Authorization', emma).expect(200);
      const bad = await t
        .http()
        .patch(`/api/v1/news/${post.id}`)
        .set('Authorization', paula)
        .send({ coverImageId: '01a00000-0000-7000-8000-000000000000' })
        .expect(422);
      expect(Object.keys(bad.body.errors)).toEqual(['coverImageId']);
    });

    it('edits in draft, scheduled and published; not archived; with optimistic locking', async () => {
      const post = await draft();
      const edited = await t
        .http()
        .patch(`/api/v1/news/${post.id}`)
        .set('Authorization', paula)
        .send({ title: 'Canteen opens at noon', bodyHtml: '<h1>New</h1><p>Hours</p>', version: post.version })
        .expect(200);
      expect(edited.body).toMatchObject({ title: 'Canteen opens at noon', bodyHtml: '<h2>New</h2><p>Hours</p>' });
      expect(
        (
          await t
            .http()
            .patch(`/api/v1/news/${post.id}`)
            .set('Authorization', paula)
            .send({ title: 'Stale', version: 1 })
            .expect(409)
        ).body.code,
      ).toBe('version_conflict');
      await act(paula, post.id, 'publish').expect(200);
      await t.http().patch(`/api/v1/news/${post.id}`).set('Authorization', emma).send({ title: 'Hacked' }).expect(403);
      const emptied = await t
        .http()
        .patch(`/api/v1/news/${post.id}`)
        .set('Authorization', paula)
        .send({ summary: '', bodyHtml: '<p></p>' })
        .expect(422);
      expect(Object.keys(emptied.body.errors).sort()).toEqual(['bodyHtml', 'summary']);
      await act(paula, post.id, 'archive').expect(200);
      expect(
        (
          await t
            .http()
            .patch(`/api/v1/news/${post.id}`)
            .set('Authorization', paula)
            .send({ title: 'Archived' })
            .expect(409)
        ).body.code,
      ).toBe('invalid_transition');
      const audit = await t.prisma.auditLog.findFirstOrThrow({ where: { entityId: post.id, action: 'update' } });
      expect(audit.changes).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'title', label: 'Title' })]),
      );
    });

    it('deletes drafts and archived posts only (soft delete)', async () => {
      const post = await draft();
      await act(paula, post.id, 'publish').expect(200);
      expect((await t.http().delete(`/api/v1/news/${post.id}`).set('Authorization', paula).expect(409)).body.code).toBe(
        'invalid_transition',
      );
      await t.http().delete(`/api/v1/news/${post.id}`).set('Authorization', emma).expect(403);
      await act(paula, post.id, 'archive').expect(200);
      await t.http().delete(`/api/v1/news/${post.id}`).set('Authorization', paula).expect(204);
      await t.http().get(`/api/v1/news/${post.id}`).set('Authorization', paula).expect(404);
      expect((await t.prisma.newsPost.findUniqueOrThrow({ where: { id: post.id } })).deletedAt).not.toBeNull();
    });
  });

  describe('lifecycle (SPEC §5.5)', () => {
    it('runs publish, archive, restore, schedule, unschedule with guards', async () => {
      const empty = await draft({ summary: '', bodyHtml: '' });
      const guard = await act(paula, empty.id, 'publish').expect(422);
      expect(Object.keys(guard.body.errors).sort()).toEqual(['bodyHtml', 'summary']);
      await act(paula, empty.id, 'schedule', { publishAt: inMinutes(60) }).expect(422);

      const post = await draft({ expireAt: inMinutes(24 * 60) });
      expect((await act(paula, post.id, 'archive').expect(409)).body.code).toBe('invalid_transition');
      await act(paula, post.id, 'publish', { now: true }).expect(422);
      let d = (await act(paula, post.id, 'publish').expect(200)).body as Post;
      expect(d).toMatchObject({ status: 'published', publishAt: null, availableActions: ['archive', 'edit'] });
      expect(d.publishedAt).not.toBeNull();
      await act(emma, post.id, 'archive').expect(403);
      d = (await act(ian, post.id, 'archive').expect(200)).body as Post;
      expect(d.status).toBe('archived');
      await t.http().get(`/api/v1/news/${post.id}`).set('Authorization', emma).expect(404);
      d = (await act(paula, post.id, 'restore').expect(200)).body as Post;
      expect(d).toMatchObject({ status: 'draft', publishAt: null, expireAt: null, publishedAt: null });

      const tooSoon = await act(paula, post.id, 'schedule', { publishAt: inMinutes(2) }).expect(422);
      expect(Object.keys(tooSoon.body.errors)).toEqual(['publishAt']);
      const badExpiry = await act(paula, post.id, 'schedule', {
        publishAt: inMinutes(60),
        expireAt: inMinutes(30),
      }).expect(422);
      expect(Object.keys(badExpiry.body.errors)).toEqual(['expireAt']);
      d = (await act(paula, post.id, 'schedule', { publishAt: inMinutes(60), expireAt: inMinutes(600) }).expect(200))
        .body as Post;
      expect(d).toMatchObject({ status: 'scheduled', availableActions: ['publish', 'unschedule', 'edit'] });
      d = (await act(paula, post.id, 'unschedule').expect(200)).body as Post;
      expect(d).toMatchObject({ status: 'draft', publishAt: null });
      await act(paula, post.id, 'schedule', { publishAt: inMinutes(60) }).expect(200);
      d = (await act(paula, post.id, 'publish').expect(200)).body as Post;
      expect(d.status).toBe('published');
      await act(paula, post.id, 'unknown').expect(404);

      const timeline = await t.http().get(`/api/v1/news/${post.id}/timeline`).set('Authorization', ian).expect(200);
      expect(timeline.body.map((e: { action: string }) => e.action)).toEqual([
        'create',
        'publish',
        'archive',
        'restore',
        'schedule',
        'unschedule',
        'schedule',
        'publish',
      ]);
    });

    it('auto-publishes due posts and auto-expires published ones (news.publish-and-expire)', async () => {
      const due = await draft({ title: 'Due now' });
      await act(paula, due.id, 'schedule', { publishAt: inMinutes(10) }).expect(200);
      const expiring = await draft({ title: 'Expiring soon' });
      await act(paula, expiring.id, 'publish').expect(200);
      await t.prisma.newsPost.update({ where: { id: expiring.id }, data: { expireAt: new Date(Date.now() - 1000) } });

      const result = await t.app.get(NewsService).publishAndExpire(new Date(Date.now() + 11 * 60_000));
      expect(result).toEqual({ published: 1, expired: 1 });
      const published = await t.prisma.newsPost.findUniqueOrThrow({ where: { id: due.id } });
      expect(published).toMatchObject({ status: 'published', publishAt: null });
      expect((await t.prisma.newsPost.findUniqueOrThrow({ where: { id: expiring.id } })).status).toBe('archived');
      const audit = await t.prisma.auditLog.findMany({
        where: { entityId: { in: [due.id, expiring.id] }, actingAs: 'system' },
      });
      expect(audit.map((a) => [a.action, a.actorId]).sort()).toEqual([
        ['auto_expire', null],
        ['auto_publish', null],
      ]);
      // Idempotent: nothing left to do.
      expect(await t.app.get(NewsService).publishAndExpire(new Date(Date.now() + 11 * 60_000))).toEqual({
        published: 0,
        expired: 0,
      });
      // The job is registered and manually runnable (202).
      const jobs = await t.http().get('/api/v1/admin/jobs').set('Authorization', ian).expect(200);
      expect(jobs.body).toContainEqual(
        expect.objectContaining({ name: 'news.publish-and-expire', slice: 'A4', cron: '*/5 * * * *' }),
      );
      await t.http().post('/api/v1/admin/jobs/news.publish-and-expire/run').set('Authorization', ian).expect(202);
    });
  });

  describe('useful links', () => {
    it('shows active links to everyone and all links to editors', async () => {
      const links = await t.http().get('/api/v1/links?includeInactive=true').set('Authorization', emma).expect(200);
      expect(links.body).toHaveLength(9);
      expect(links.body[0]).toMatchObject({
        title: 'Wiki',
        url: 'https://wiki.example.com',
        icon: 'book',
        sortOrder: 0,
      });
      const all = await t.http().get('/api/v1/links?includeInactive=true').set('Authorization', paula).expect(200);
      expect(all.body).toHaveLength(10);
      expect(all.body.find((l: { title: string }) => l.title === 'Brand assets').active).toBe(false);
    });

    it('lets editors create, edit, reorder and delete links', async () => {
      const body = { title: 'Room booking', url: 'https://rooms.example.com', icon: 'calendar', category: 'Workplace' };
      await t.http().post('/api/v1/links').set('Authorization', emma).send(body).expect(403);
      const bad = await t
        .http()
        .post('/api/v1/links')
        .set('Authorization', paula)
        .send({ ...body, url: 'http://rooms.example.com', icon: 'rocket' })
        .expect(422);
      expect(Object.keys(bad.body.errors).sort()).toEqual(['icon', 'url']);
      const created = await t.http().post('/api/v1/links').set('Authorization', paula).send(body).expect(201);
      expect(created.body).toMatchObject({ ...body, description: null, active: true, sortOrder: 10 });
      const patched = await t
        .http()
        .patch(`/api/v1/links/${created.body.id}`)
        .set('Authorization', ian)
        .send({ description: 'Meeting rooms at every site.', active: false })
        .expect(200);
      expect(patched.body).toMatchObject({ description: 'Meeting rooms at every site.', active: false });

      const all = (await t.http().get('/api/v1/links?includeInactive=true').set('Authorization', paula).expect(200))
        .body as { id: string }[];
      await t
        .http()
        .put('/api/v1/links/order')
        .set('Authorization', paula)
        .send({ ids: all.slice(1).map((l) => l.id) })
        .expect(422);
      const reversed = all.map((l) => l.id).reverse();
      const ordered = await t
        .http()
        .put('/api/v1/links/order')
        .set('Authorization', paula)
        .send({ ids: reversed })
        .expect(200);
      expect(ordered.body.map((l: { id: string }) => l.id)).toEqual(reversed);
      expect(ordered.body[0].sortOrder).toBe(0);
      await t.http().put('/api/v1/links/order').set('Authorization', emma).send({ ids: reversed }).expect(403);

      await t.http().delete(`/api/v1/links/${created.body.id}`).set('Authorization', emma).expect(403);
      await t.http().delete(`/api/v1/links/${created.body.id}`).set('Authorization', paula).expect(204);
      await t.http().delete(`/api/v1/links/${created.body.id}`).set('Authorization', paula).expect(404);
      const audit = await t.prisma.auditLog.findMany({
        where: { entityId: created.body.id },
        orderBy: { occurredAt: 'asc' },
      });
      expect(audit.map((a) => a.action)).toEqual(['create', 'update', 'reorder', 'delete']);
    });
  });
});
