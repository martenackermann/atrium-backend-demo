import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Booking PIN encryption at rest (D12): AES-256-GCM with ENCRYPTION_KEY (64 hex chars).
 * Stored as `v1.<iv>.<tag>.<ciphertext>` (base64url parts). The PIN never leaves the API
 * except through the audited `GET /travel/requests/{id}/booking/pin`.
 */
const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function keyFrom(hex: string): Buffer {
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  return key;
}

/** Every call uses a fresh random 96-bit IV (never reuse an IV with the same GCM key). */
export function encryptPin(pin: string, keyHex: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(keyHex), iv, { authTagLength: TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(pin, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

/** Throws for unknown formats, a wrong key or tampering (including truncated auth tags). */
export function decryptPin(stored: string, keyHex: string): string {
  const [version, ivPart, tagPart, ciphertext, extra] = stored.split('.');
  if (version !== VERSION || !ivPart || !tagPart || ciphertext === undefined || extra !== undefined) {
    throw new Error('Unsupported PIN format');
  }
  const iv = Buffer.from(ivPart, 'base64url');
  const tag = Buffer.from(tagPart, 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error('Unsupported PIN format');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(keyHex), iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}
