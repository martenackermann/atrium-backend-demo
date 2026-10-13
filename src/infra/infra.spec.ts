import { describe, expect, it } from 'vitest';
import { validateEnv } from '@/config/env.schema';
import { compareInboxItems } from '@/modules/core/inbox/inbox.service';
import type { InboxItem } from '@/modules/core/contracts/inbox.contract';
import { windowsOverlap } from '@/modules/core/deputies/deputies.service';
import { enumOptions, sentenceCase } from '@/modules/core/meta/enum.registry';
import { contentDisposition } from '@/modules/core/attachments/attachments.controller';
import { addDaysIso, startOfDayInZone, withinWindow } from '@/common/time/time';
import { initialsOf } from '@/common/domain/mappers';
import { htmlToText, MailRenderer } from './mail/mail-renderer';
import { mjml, raw } from './mail/mjml';
import { decodeUploadFileName, detectMimeType, MIME, sanitizeFileName } from './storage/file-validation';
import { createSignedToken, verifySignedToken } from './storage/signed-url';

describe('env schema', () => {
  const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db', JWT_SECRET: 'x'.repeat(32) };

  it('applies SPEC §9 defaults and parses lists/booleans', () => {
    const env = validateEnv({
      ...base,
      CORS_ORIGINS: 'http://a.example.com, http://b.example.com',
      DEMO_MODE: 'false',
    });
    expect(env).toMatchObject({
      PORT: 3100,
      JWT_TTL_MINUTES: 480,
      APP_TIMEZONE: 'Europe/Berlin',
      FALLBACK_APPROVER_EMAIL: 'clara.ceo@example.com',
      ENABLE_REMINDER_CRONS: false,
      SEED_FAKER_SEED: 4711,
      DEMO_MODE: false,
    });
    expect(env.CORS_ORIGINS).toEqual(['http://a.example.com', 'http://b.example.com']);
    expect(validateEnv(base).CORS_ORIGINS).toHaveLength(5);
    expect(validateEnv({ ...base, DEMO_RESET_CRON: '', SEED_TODAY: '' })).toMatchObject({
      DEMO_RESET_CRON: undefined,
      SEED_TODAY: undefined,
    });
  });

  it('lists every problem', () => {
    const run = () => validateEnv({ JWT_SECRET: 'short', PORT: 'abc', SEED_TODAY: 'yesterday' });
    for (const key of ['DATABASE_URL', 'JWT_SECRET', 'PORT', 'SEED_TODAY']) expect(run).toThrow(key);
  });
});

describe('time helpers', () => {
  it('computes local midnight in APP_TIMEZONE as UTC (DST aware)', () => {
    expect(startOfDayInZone('2026-10-13', 'Europe/Berlin').toISOString()).toBe('2026-10-12T22:00:00.000Z');
    expect(startOfDayInZone('2026-12-01', 'Europe/Berlin').toISOString()).toBe('2026-11-30T23:00:00.000Z');
    expect(addDaysIso('2026-10-30', 3)).toBe('2026-11-02');
    expect(withinWindow('2026-10-13', null, '2026-10-13')).toBe(true);
    expect(withinWindow('2026-10-13', '2026-10-14', null)).toBe(false);
  });
});

describe('deputy windows', () => {
  it('detects overlaps with open ends', () => {
    expect(windowsOverlap({ from: '2026-10-01', to: '2026-10-10' }, { from: '2026-10-10', to: null })).toBe(true);
    expect(windowsOverlap({ from: '2026-10-01', to: '2026-10-09' }, { from: '2026-10-10', to: null })).toBe(false);
    expect(windowsOverlap({ from: null, to: null }, { from: '2030-01-01', to: '2030-01-02' })).toBe(true);
  });
});

describe('inbox order', () => {
  const item = (title: string, priority: 'high' | 'normal', dueAt: string | null, createdAt: string) =>
    ({ title, priority, dueAt, createdAt }) as InboxItem;

  it('sorts high first, then dueAt ascending (nulls last), then createdAt', () => {
    const sorted = [
      item('c', 'normal', null, '2026-01-01T00:00:00.000Z'),
      item('b', 'normal', '2026-02-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'),
      item('a', 'high', null, '2026-01-03T00:00:00.000Z'),
      item('d', 'normal', '2026-02-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
    ].sort(compareInboxItems);
    expect(sorted.map((i) => i.title)).toEqual(['a', 'd', 'b', 'c']);
  });
});

describe('enum options', () => {
  it('sentence-cases values and applies overrides with DESIGN tones', () => {
    expect(sentenceCase('in_person')).toBe('In person');
    expect(enumOptions(['to_book', 'one_way'], { to_book: ['To book', 'moving'] })).toEqual([
      { value: 'to_book', label: 'To book', tone: 'moving', description: null },
      { value: 'one_way', label: 'One way', tone: null, description: null },
    ]);
  });

  it('builds initials', () => {
    expect(initialsOf({ displayName: 'Emma Employee' })).toBe('EE');
    expect(initialsOf({ displayName: 'x', firstName: 'Sofia', lastName: 'Site-Manager' })).toBe('SS');
  });
});

describe('signed tokens', () => {
  const secret = Buffer.from('k'.repeat(32));

  it('round-trips and detects tampering and expiry', () => {
    const token = createSignedToken(secret, { a: 'att', e: 2_000 });
    expect(verifySignedToken(secret, token, 1_000)).toEqual({ ok: true, payload: { a: 'att', e: 2_000 } });
    expect(verifySignedToken(secret, token, 3_000)).toEqual({ ok: false, reason: 'expired' });
    expect(verifySignedToken(Buffer.from('other'), token, 1_000)).toEqual({ ok: false, reason: 'signature' });
    expect(verifySignedToken(secret, 'garbage', 1_000)).toEqual({ ok: false, reason: 'malformed' });
  });
});

describe('uploads', () => {
  it('detects MIME types from magic bytes, never from the name', () => {
    expect(detectMimeType(Buffer.from('%PDF-1.7'), 'x.png')).toBe(MIME.pdf);
    expect(detectMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), 'x')).toBe(MIME.png);
    expect(detectMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'x.jpg')).toBe(MIME.jpeg);
    expect(detectMimeType(Buffer.concat([Buffer.from('RIFF0000WEBP')]), 'x')).toBe(MIME.webp);
    const docx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('....word/document.xml')]);
    expect(detectMimeType(docx, 'a.docx')).toBe(MIME.docx);
    expect(detectMimeType(docx, 'a.zip')).toBeNull();
    expect(detectMimeType(Buffer.from('MZ\x90'), 'a.pdf')).toBeNull();
  });

  it('sanitises file names', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('C:\\temp\\a<b>.pdf')).toBe('a_b_.pdf');
    expect(sanitizeFileName('bad\u0000name.pdf')).toBe('badname.pdf');
    expect(sanitizeFileName('..')).toBe('file');
    expect(sanitizeFileName(`${'x'.repeat(300)}.pdf`)).toHaveLength(200);
    expect(decodeUploadFileName(Buffer.from('Ü.pdf', 'utf8').toString('latin1'))).toBe('Ü.pdf');
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

  it('renders the shared layout with wordmark, action button, priority badge and footer', async () => {
    const rendered = await new MailRenderer().render({
      subject: 'Hello',
      body: mjml`<mj-text>Hi ${'Emma'}</mj-text>`,
      action: { label: 'View in Atrium', url: 'http://localhost:3000/inbox' },
      highPriority: true,
    });
    expect(rendered.html).toContain('<!doctype html>');
    expect(rendered.html).toContain('Atrium');
    expect(rendered.html).toContain('HIGH PRIORITY');
    expect(rendered.html).toContain('Acme IT Services · demo');
    expect(rendered.text).toContain('Hi Emma');
    expect(rendered.text).toContain('View in Atrium (http://localhost:3000/inbox)');
    expect(htmlToText('<p>a&amp;b</p><p>c</p>')).toBe('a&b\nc');
  });
});
