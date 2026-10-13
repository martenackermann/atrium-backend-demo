import { createHmac, timingSafeEqual } from 'node:crypto';

/** Any JSON payload with an expiry `e` (unix seconds). */
export interface SignedPayload {
  e: number;
  [key: string]: unknown;
}

export type VerifyResult =
  | { ok: true; payload: SignedPayload }
  | { ok: false; reason: 'malformed' | 'signature' | 'expired' };

const encode = (value: Buffer | string): string => Buffer.from(value).toString('base64url');

function sign(secret: Buffer, body: string): Buffer {
  return createHmac('sha256', secret).update(body).digest();
}

/** `<base64url(json)>.<base64url(hmac-sha256)>` - opaque, URL-safe, tamper-proof. */
export function createSignedToken(secret: Buffer, payload: SignedPayload): string {
  const body = encode(JSON.stringify(payload));
  return `${body}.${encode(sign(secret, body))}`;
}

export function verifySignedToken(secret: Buffer, token: string, nowSeconds = Math.floor(Date.now() / 1000)): VerifyResult {
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined) return { ok: false, reason: 'malformed' };

  const expected = sign(secret, body);
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'signature' };

  let payload: SignedPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SignedPayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof payload !== 'object' || payload === null || typeof payload.e !== 'number') {
    return { ok: false, reason: 'malformed' };
  }
  if (payload.e < nowSeconds) return { ok: false, reason: 'expired' };
  return { ok: true, payload };
}
