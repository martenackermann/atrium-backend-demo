import { describe, expect, it } from 'vitest';
import { redactLoggedUrl } from './logging.module';

describe('request log redaction', () => {
  it('drops signed download tokens from logged URLs', () => {
    expect(redactLoggedUrl('/api/v1/files/eyJhIjoiMSJ9.c2lnbmF0dXJl')).toBe('/api/v1/files/[redacted]');
    expect(redactLoggedUrl('/api/v1/files/abc.def?x=1')).toBe('/api/v1/files/[redacted]?x=1');
    expect(redactLoggedUrl('/api/v1/attachments/123/download-url')).toBe('/api/v1/attachments/123/download-url');
    expect(redactLoggedUrl(undefined)).toBeUndefined();
  });
});
