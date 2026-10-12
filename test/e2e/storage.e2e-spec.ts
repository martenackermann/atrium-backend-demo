import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StorageService } from '@/infra/storage/storage.service';
import { createTestApp, type TestApp } from '../support/test-app';

const PDF = Buffer.from('%PDF-1.7\n% demo file\n');

describe('storage and signed downloads', () => {
  let t: TestApp;
  let storage: StorageService;

  beforeAll(async () => {
    t = await createTestApp();
    storage = t.app.get(StorageService);
  });

  afterAll(async () => {
    await t?.close();
  });

  const pathOf = (url: string) => new URL(url).pathname;

  it('stores a file under a random key and serves it through a signed URL', async () => {
    const stored = await storage.save(PDF, { originalName: 'Expense report Ü.pdf', mimeType: 'application/pdf' });
    expect(stored.key).toMatch(/^\d{4}\/\d{2}\/[\w-]{21}\.pdf$/);
    expect(stored.size).toBe(PDF.length);

    const url = storage.createDownloadUrl(stored.key, {
      fileName: 'Expense report Ü.pdf',
      mimeType: 'application/pdf',
    });
    expect(url).toMatch(/^http:\/\/localhost:3100\/api\/v1\/files\//);

    const res = await t.http().get(pathOf(url)).buffer(true).expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain("filename*=UTF-8''Expense%20report%20%C3%9C.pdf");
    expect(Buffer.from(res.body as Buffer).equals(PDF)).toBe(true);
  });

  it('rejects tampered tokens with 403 problem+json', async () => {
    const stored = await storage.save(PDF, { originalName: 'a.pdf', mimeType: 'application/pdf' });
    const token = storage.createDownloadToken(stored.key);
    const [body, sig] = token.split('.');
    const forged = `${body}x.${sig}`;
    const res = await t.http().get(`/api/v1/files/${forged}`).expect(403);
    expect(res.headers['content-type']).toMatch(/problem\+json/);
  });

  it('rejects expired links with 410', async () => {
    const stored = await storage.save(PDF, { originalName: 'a.pdf', mimeType: 'application/pdf' });
    const token = storage.createDownloadToken(stored.key, { expiresInSeconds: -1 });
    const res = await t.http().get(`/api/v1/files/${token}`).expect(410);
    expect(res.body.type).toBe('https://atrium.example.com/problems/gone');
  });

  it('answers 404 when the file was deleted', async () => {
    const stored = await storage.save(PDF, { originalName: 'a.pdf', mimeType: 'application/pdf' });
    const token = storage.createDownloadToken(stored.key);
    await storage.delete(stored.key);
    await t.http().get(`/api/v1/files/${token}`).expect(404);
  });
});
