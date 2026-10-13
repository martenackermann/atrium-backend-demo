import { createHash, createHmac } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { AppConfig } from '@/config/app-config';
import { createSignedToken, verifySignedToken } from './signed-url';

export interface StoredBlob {
  /** `yyyy/mm/<uuid>` - opaque, never derived from the file name. Persist this. */
  key: string;
  sizeBytes: number;
  /** Hex SHA-256 of the content. */
  sha256: string;
}

const KEY_PATTERN = /^\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Private local-disk blob storage under STORAGE_DIR (outside any web root) plus HMAC-signed,
 * expiring tokens (FILE_SIGNING_SECRET). Attachment metadata and access rules live in the
 * core AttachmentService; modules use that, not this service.
 */
@Injectable()
export class StorageService {
  readonly root: string;
  private readonly signingKey: Buffer;

  constructor(config: AppConfig) {
    this.root = resolve(config.get('STORAGE_DIR'));
    this.signingKey = createHmac('sha256', config.get('FILE_SIGNING_SECRET')).update('atrium:file-url').digest();
  }

  /** Writes a new blob under a random key (never overwrites). */
  async save(content: Buffer, now = new Date()): Promise<StoredBlob> {
    const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${uuidv7()}`;
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, { flag: 'wx' });
    return { key, sizeBytes: content.length, sha256: createHash('sha256').update(content).digest('hex') };
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await stat(this.pathFor(key))).isFile();
    } catch {
      return false;
    }
  }

  read(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  openRead(key: string): ReadStream {
    return createReadStream(this.pathFor(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  /** Signs an arbitrary JSON payload with an expiry (unix seconds in `e`). */
  sign<T extends object>(payload: T, ttlSeconds: number, now = Date.now()): { token: string; expiresAt: Date } {
    const expiresAt = new Date(now + ttlSeconds * 1000);
    return {
      token: createSignedToken(this.signingKey, { ...payload, e: Math.floor(expiresAt.getTime() / 1000) }),
      expiresAt,
    };
  }

  /** Returns the payload of a valid, unexpired token, else null. */
  verify<T extends object>(token: string): (T & { e: number }) | null {
    const result = verifySignedToken(this.signingKey, token);
    return result.ok ? (result.payload as T & { e: number }) : null;
  }

  /** Resolves a key inside STORAGE_DIR; rejects anything that could escape it. */
  pathFor(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new Error(`Invalid storage key "${key}"`);
    const path = resolve(this.root, ...key.split('/'));
    const rel = relative(this.root, path);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
      throw new Error(`Invalid storage key "${key}"`);
    }
    return path;
  }
}
