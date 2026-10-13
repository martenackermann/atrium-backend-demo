import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AttachmentService } from '@/modules/core/attachments/attachment.service';
import { FixturesModule } from '../support/fixtures.module';
import { createTestApp, type TestApp } from '../support/test-app';

const PDF = Buffer.from('%PDF-1.7\n% demo file\n');
const EXE = Buffer.from('MZ\x90\x00 not a document');

describe('attachments: staged upload, link, signed download', () => {
  let t: TestApp;
  let emma: string;
  let max: string;
  let ian: string;

  beforeAll(async () => {
    t = await createTestApp({ imports: [FixturesModule] });
    [emma, max, ian] = await Promise.all([t.login('emma'), t.login('max'), t.login('ian')]);
  });

  afterAll(async () => {
    await t?.close();
  });

  const upload = (auth: string, purpose: string, content: Buffer, name: string) =>
    t
      .http()
      .post('/api/v1/attachments')
      .set('Authorization', auth)
      .field('purpose', purpose)
      .attach('file', content, name);

  it('stages an upload with MIME type from magic bytes and a sanitised name', async () => {
    const res = await upload(emma, 'training_document', PDF, '../../Agenda Ü.pdf').expect(201);
    expect(res.body).toMatchObject({
      originalName: 'Agenda Ü.pdf',
      mimeType: 'application/pdf',
      sizeBytes: PDF.length,
      purpose: 'training_document',
      uploadedBy: { displayName: 'Emma Employee' },
    });
    const row = await t.prisma.attachment.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.storageKey).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}$/);
    expect(row.entityId).toBeNull();
  });

  it('enforces purpose rights (403), file types (415), size (413) and the purpose field (422)', async () => {
    expect((await upload(emma, 'travel_booking_confirmation', PDF, 'a.pdf').expect(403)).body.code).toBe('forbidden');
    expect((await upload(emma, 'training_document', EXE, 'a.pdf').expect(415)).body.code).toBe(
      'unsupported_media_type',
    );
    const big = Buffer.concat([PDF, Buffer.alloc(1024 * 1024)]);
    expect((await upload(emma, 'training_document', big, 'big.pdf').expect(413)).body.code).toBe('payload_too_large');
    await upload(emma, 'nonsense', PDF, 'a.pdf').expect(422);
  });

  it('shows staged files only to the uploader and serves them via signed URLs', async () => {
    const { body } = await upload(emma, 'people_document', PDF, 'contract.pdf').expect(201);
    await t.http().get(`/api/v1/attachments/${body.id}`).set('Authorization', max).expect(404);
    await t.http().get(`/api/v1/attachments/${body.id}`).set('Authorization', emma).expect(200);

    const link = await t
      .http()
      .get(`/api/v1/attachments/${body.id}/download-url?disposition=inline`)
      .set('Authorization', emma)
      .expect(200);
    expect(link.body.url).toMatch(/^http:\/\/localhost:3100\/api\/v1\/files\//);
    expect(new Date(link.body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const file = await t.http().get(new URL(link.body.url).pathname).buffer(true).expect(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['cache-control']).toBe('private, no-store');
    expect(file.headers['content-disposition']).toBe(`inline; filename="contract.pdf"; filename*=UTF-8''contract.pdf`);
    expect(Buffer.from(file.body as Buffer).equals(PDF)).toBe(true);

    const token = new URL(link.body.url).pathname.split('/').pop()!;
    const res = await t
      .http()
      .get(`/api/v1/files/${token.slice(0, -2)}xx`)
      .expect(404);
    expect(res.body.code).toBe('not_found');
  });

  it('links staged files through AttachmentService (policy decides visibility) and deletes only staged ones', async () => {
    const service = t.app.get(AttachmentService);
    const emmaId = await t.userId('emma');
    const { body: att } = await upload(emma, 'training_document', PDF, 'notes.pdf').expect(201);
    const toyId = '0192f1c2-8e4b-7c3a-9d2e-aaaaaaaaaaaa';
    await t.prisma.systemSetting.create({
      data: {
        key: `toy:${toyId}`,
        value: { id: toyId, ownerId: emmaId, status: 'draft', decidedBy: null, reason: null, version: 1 },
      },
    });
    const actor = {
      id: emmaId,
      email: 'emma.employee@example.com',
      displayName: 'Emma Employee',
      roles: ['employee' as const],
      isSiteManager: false,
      sessionId: null,
    };

    await expect(
      t.prisma.$transaction((tx) =>
        service.link(tx, {
          ids: [att.id],
          entityType: 'toy_request',
          entityId: toyId,
          purposes: ['travel_booking_confirmation'],
          actor,
        }),
      ),
    ).rejects.toMatchObject({ problem: { status: 422, errors: { 'attachmentIds.0': [expect.any(String)] } } });

    await t.prisma.$transaction((tx) =>
      service.link(tx, {
        ids: [att.id],
        entityType: 'toy_request',
        entityId: toyId,
        purposes: ['training_document'],
        actor,
      }),
    );
    expect(await service.listFor('toy_request', toyId)).toEqual([expect.objectContaining({ id: att.id })]);

    // ToyAttachmentPolicy: owner and it_admin may view, Max may not
    await t.http().get(`/api/v1/attachments/${att.id}`).set('Authorization', ian).expect(200);
    await t.http().get(`/api/v1/attachments/${att.id}`).set('Authorization', max).expect(404);

    const conflict = await t.http().delete(`/api/v1/attachments/${att.id}`).set('Authorization', emma).expect(409);
    expect(conflict.body.code).toBe('conflict');
    const { body: staged } = await upload(emma, 'training_document', PDF, 'tmp.pdf').expect(201);
    await t.http().delete(`/api/v1/attachments/${staged.id}`).set('Authorization', emma).expect(204);
  });
});
