import { createHash, createHmac } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Injectable } from '@nestjs/common';
import { extension as extensionForMime } from 'mime-types';
import { nanoid } from 'nanoid';
import { ProblemException } from '@/common/http/problem';
import { AppConfig } from '@/config/app-config';
import { createSignedToken, type SignedFilePayload, verifySignedToken } from './signed-url';

export interface StoredFile {
  /** Opaque storage key, e.g. "2026/10/V1StGXR8_Z5jdHi6B-myT.pdf". Persist this. */
  key: string;
  size: number;
  mimeType: string;
  originalName: string;
  /** Hex SHA-256 of the content. */
  sha256: string;
}

export interface DownloadUrlOptions {
  /** Lifetime in seconds. Default 300 (5 min). */
  expiresInSeconds?: number;
  /** File name presented to the browser. */
  fileName?: string;
  mimeType?: string;
  disposition?: 'inline' | 'attachment';
}

const KEY_PATTERN = /^\d{4}\/\d{2}\/[\w-]{21}(\.[a-z0-9]{1,10})?$/;
export const FILES_ROUTE = 'files';

/**
 * Local-disk file storage under STORAGE_DIR with random names, plus HMAC-signed,
 * expiring download URLs served by `GET /api/v1/files/:token`.
 */
@Injectable()
export class StorageService {
  readonly root: string;
  private readonly signingKey: Buffer;

  constructor(private readonly config: AppConfig) {
    this.root = resolve(config.get('STORAGE_DIR'));
    this.signingKey = createHmac('sha256', config.get('JWT_SECRET')).update('atrium:storage:signed-url').digest();
  }

  /** Writes a file and returns its metadata. Validate first with `assertValidUpload()`. */
  async save(content: Buffer, meta: { originalName: string; mimeType: string }): Promise<StoredFile> {
    const now = new Date();
    const ext = (extname(meta.originalName).slice(1) || extensionForMime(meta.mimeType) || '').toLowerCase();
    const safeExt = /^[a-z0-9]{1,10}$/.test(ext) ? `.${ext}` : '';
    const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${nanoid()}${safeExt}`;
    const path = this.pathFor(key);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, content, { flag: 'wx' });
    return {
      key,
      size: content.length,
      mimeType: meta.mimeType,
      originalName: meta.originalName,
      sha256: createHash('sha256').update(content).digest('hex'),
    };
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await stat(this.pathFor(key))).isFile();
    } catch {
      return false;
    }
  }

  openRead(key: string): ReadStream {
    return createReadStream(this.pathFor(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  /** Absolute download URL valid for `expiresInSeconds`. Hand it to the client as is. */
  createDownloadUrl(key: string, options: DownloadUrlOptions = {}): string {
    return `${this.config.get('APP_URL')}/api/v1/${FILES_ROUTE}/${this.createDownloadToken(key, options)}`;
  }

  createDownloadToken(key: string, options: DownloadUrlOptions = {}): string {
    this.assertKey(key);
    const payload: SignedFilePayload = {
      k: key,
      e: Math.floor(Date.now() / 1000) + (options.expiresInSeconds ?? 300),
      ...(options.fileName ? { n: options.fileName } : {}),
      ...(options.mimeType ? { t: options.mimeType } : {}),
      ...(options.disposition ? { d: options.disposition } : {}),
    };
    return createSignedToken(this.signingKey, payload);
  }

  /** Verifies a download token or throws a problem (403 invalid / 410 expired). */
  verifyDownloadToken(token: string): SignedFilePayload {
    const result = verifySignedToken(this.signingKey, token);
    if (result.ok) return result.payload;
    if (result.reason === 'expired') throw ProblemException.gone('This download link has expired.');
    throw ProblemException.forbidden('This download link is invalid.');
  }

  /** Resolves a key inside STORAGE_DIR; rejects anything that could escape it. */
  pathFor(key: string): string {
    this.assertKey(key);
    const path = resolve(this.root, ...key.split('/'));
    const rel = relative(this.root, path);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
      throw new Error(`Invalid storage key "${key}"`);
    }
    return path;
  }

  private assertKey(key: string): void {
    if (!KEY_PATTERN.test(key)) throw new Error(`Invalid storage key "${key}"`);
  }
}
