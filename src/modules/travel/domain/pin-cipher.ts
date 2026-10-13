import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Booking PIN encryption at rest (D12): AES-256-GCM with ENCRYPTION_KEY (64 hex chars).
 * Stored as `v1.<iv>.<tag>.<ciphertext>` (base64url parts). The PIN never leaves the API
 * except through the audited `GET /travel/requests/{id}/booking/pin`.
 */
const VERSION = 'v1';

function keyFrom(hex: string): Buffer {
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  return key;
}

export function encryptPin(pin: string, keyHex: string, iv: Buffer = randomBytes(12)): string {
  const cipher = createCipheriv('aes-256-gcm', keyFrom(keyHex), iv);
  const ciphertext = Buffer.concat([cipher.update(pin, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptPin(stored: string, keyHex: string): string {
  const [version, iv, tag, ciphertext] = stored.split('.');
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) throw new Error('Unsupported PIN format');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(keyHex), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}
