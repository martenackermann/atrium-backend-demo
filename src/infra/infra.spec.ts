import { describe, expect, it } from 'vitest';
import { validateEnv } from '@/config/env.schema';
import { ttlToSeconds } from '@/common/auth/token.service';
import { MailRenderer } from './mail/mail-renderer';
import { mjml, raw } from './mail/mail-template';
import { systemTestMail } from './mail/templates/system-test.mail';
import { checkUpload } from './storage/file-validation';
import { contentDisposition } from './storage/files.controller';
import { createSignedToken, verifySignedToken } from './storage/signed-url';

describe('env schema', () => {
  const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db', JWT_SECRET: 'x'.repeat(32) };

  it('applies defaults and parses lists/booleans', () => {
    const env = validateEnv({
      ...base,
      CORS_ORIGINS: 'http://a.example.com, http://b.example.com',
      DEMO_MODE: 'false',
    });
    expect(env.PORT).toBe(3100);
    expect(env.CORS_ORIGINS).toEqual(['http://a.example.com', 'http://b.example.com']);
    expect(env.DEMO_MODE).toBe(false);
    expect(env.JWT_TTL).toBe('8h');
  });

  it('lists every problem', () => {
    const run = () => validateEnv({ JWT_SECRET: 'short', PORT: 'abc' });
    for (const key of ['DATABASE_URL', 'JWT_SECRET', 'PORT']) expect(run).toThrow(key);
  });
});

describe('ttlToSeconds', () => {
  it('understands units', () => {
    expect(ttlToSeconds('3600')).toBe(3600);
    expect(ttlToSeconds('15m')).toBe(900);
    expect(ttlToSeconds('8h')).toBe(28800);
    expect(ttlToSeconds('7d')).toBe(604800);
    expect(() => ttlToSeconds('soon')).toThrow();
  });
});

describe('signed tokens', () => {
  const secret = Buffer.from('k'.repeat(32));

  it('round-trips and detects tampering and expiry', () => {
    const token = createSignedToken(secret, { k: '2026/10/abc', e: 2_000 });
    expect(verifySignedToken(secret, token, 1_000)).toEqual({ ok: true, payload: { k: '2026/10/abc', e: 2_000 } });
    expect(verifySignedToken(secret, token, 3_000)).toEqual({ ok: false, reason: 'expired' });
    expect(verifySignedToken(Buffer.from('other'), token, 1_000)).toEqual({ ok: false, reason: 'signature' });
    expect(verifySignedToken(secret, 'garbage', 1_000)).toEqual({ ok: false, reason: 'malformed' });
  });
});

describe('upload validation', () => {
  const rules = { maxBytes: 1024, allowedMimeTypes: ['application/pdf'] };
  const pdf = Buffer.from('%PDF-1.7');

  it('accepts a matching PDF', () => {
    expect(
      checkUpload({ originalname: 'a.pdf', mimetype: 'application/pdf', size: pdf.length, buffer: pdf }, rules),
    ).toEqual([]);
  });

  it('rejects size, type, extension and content mismatches', () => {
    expect(checkUpload({ originalname: 'a.pdf', mimetype: 'application/pdf', size: 2048 }, rules)[0]).toMatch(
      /too large/,
    );
    expect(checkUpload({ originalname: 'a.exe', mimetype: 'application/x-msdownload', size: 10 }, rules)[0]).toMatch(
      /not allowed/,
    );
    expect(checkUpload({ originalname: 'a.png', mimetype: 'application/pdf', size: 10 }, rules)).toEqual([
      'The file extension does not match its type.',
    ]);
    expect(
      checkUpload({ originalname: 'a.pdf', mimetype: 'application/pdf', size: 3, buffer: Buffer.from('MZ!') }, rules),
    ).toEqual(['The file content does not match its type.']);
  });

  it('builds RFC 6266 content-disposition headers', () => {
    expect(contentDisposition('Ü "x".pdf')).toBe(
      `attachment; filename="_ _x_.pdf"; filename*=UTF-8''%C3%9C%20%22x%22.pdf`,
    );
  });
});

describe('mail rendering', () => {
  it('escapes interpolations unless raw()', () => {
    expect(mjml`<mj-text>${'<b>x</b>'} ${raw('<i>y</i>')} ${['a', '&']}</mj-text>`).toBe(
      '<mj-text>&lt;b&gt;x&lt;/b&gt; <i>y</i> a&amp;</mj-text>',
    );
  });

  it('renders templates inside the Atrium layout with a text part', async () => {
    const rendered = await new MailRenderer().render(systemTestMail, systemTestMail.preview);
    expect(rendered.subject).toBe('Atrium test message');
    expect(rendered.html).toContain('<!doctype html>');
    expect(rendered.html).toContain('Acme IT Services · demo');
    expect(rendered.text).toContain('Hello Emma Employee');
    expect(rendered.text).toContain('Atrium');
  });
});
