import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SignedFilePayload {
  /** Storage key. */
  k: string;
  /** Expiry, unix seconds. */
  e: number;
  /** Download file name. */
  n?: string;
  /** MIME type. */
  t?: string;
  /** Content-Disposition type. */
  d?: 'inline' | 'attachment';
}

export type VerifyResult =
  | { ok: true; payload: SignedFilePayload }
  | { ok: false; reason: 'malformed' | 'signature' | 'expired' };

const encode = (value: Buffer | string): string => Buffer.from(value).toString('base64url');

function sign(secret: Buffer, body: string): Buffer {
  return createHmac('sha256', secret).update(body).digest();
}

/** `<base64url(json)>.<base64url(hmac-sha256)>` - opaque, URL-safe, tamper-proof. */
export function createSignedToken(secret: Buffer, payload: SignedFilePayload): string {
  const body = encode(JSON.stringify(payload));
  return `${body}.${encode(sign(secret, body))}`;
}

export function verifySignedToken(secret: Buffer, token: string, nowSeconds = Math.floor(Date.now() / 1000)): VerifyResult {
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined) return { ok: false, reason: 'malformed' };

  const expected = sign(secret, body);
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'signature' };

  let payload: SignedFilePayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SignedFilePayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof payload.k !== 'string' || typeof payload.e !== 'number') return { ok: false, reason: 'malformed' };
  if (payload.e < nowSeconds) return { ok: false, reason: 'expired' };
  return { ok: true, payload };
}
