import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@/common/auth/auth-user';
import { toUserRef } from '@/common/domain/mappers';
import type { AttachmentPurpose } from '@/common/domain/vocabulary';
import { ProblemException } from '@/common/http/problem';
import { Clock } from '@/common/time/clock.service';
import { AppConfig } from '@/config/app-config';
import { PrismaService } from '@/database/prisma.service';
import type { PrismaTx } from '@/database/prisma.types';
import type { Prisma } from '@/generated/prisma/client';
import { detectMimeType, sanitizeFileName } from '@/infra/storage/file-validation';
import { StorageService } from '@/infra/storage/storage.service';
import { ProviderRegistry } from '../contracts/provider.registry';
import { ALLOWED_MIME_BY_PURPOSE, mayUpload } from './attachment-rules';

export type AttachmentRow = Prisma.AttachmentGetPayload<{ include: { uploadedBy: true } }>;

export interface AttachmentView {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  purpose: AttachmentPurpose;
  uploadedBy: ReturnType<typeof toUserRef>;
  createdAt: string;
}

/** Payload of a signed download token: attachment, user and disposition (+ expiry `e`). */
interface DownloadToken {
  a: string;
  u: string;
  d: 'inline' | 'attachment';
}

export interface LinkAttachmentsInput {
  ids: readonly string[];
  entityType: string;
  entityId: string;
  /** Purposes accepted for this link (e.g. ['travel_booking_confirmation']). */
  purposes: readonly AttachmentPurpose[];
  actor: AuthUser;
  /** Field name used in 422 errors. Default `attachmentIds`. */
  field?: string;
}

/**
 * Staged uploads (D11): upload first (`POST /attachments`), then link by id from the
 * owning resource with `link(tx, ...)`. Files are private and served via signed URLs.
 */
@Injectable()
export class AttachmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly providers: ProviderRegistry,
    private readonly config: AppConfig,
    private readonly clock: Clock,
  ) {}

  async upload(
    user: AuthUser,
    file: { buffer: Buffer; originalname: string; size: number } | undefined,
    purpose: AttachmentPurpose,
  ): Promise<AttachmentView> {
    if (!file) throw ProblemException.fieldError('file', 'Required');
    if (!mayUpload(user, purpose)) throw ProblemException.forbidden('You may not upload files for this purpose.');
    if (file.size > this.config.get('UPLOAD_MAX_BYTES')) {
      throw ProblemException.payloadTooLarge(`Files may be at most ${this.config.get('UPLOAD_MAX_BYTES')} bytes.`);
    }
    if (file.size === 0) throw ProblemException.fieldError('file', 'The file is empty.');
    const originalName = sanitizeFileName(file.originalname);
    const mimeType = detectMimeType(file.buffer, originalName);
    if (!mimeType || !ALLOWED_MIME_BY_PURPOSE[purpose].includes(mimeType)) {
      throw ProblemException.unsupportedMediaType(
        `Allowed file types for ${purpose}: ${ALLOWED_MIME_BY_PURPOSE[purpose].join(', ')}.`,
      );
    }
    const blob = await this.storage.save(file.buffer, this.clock.now());
    const row = await this.prisma.attachment.create({
      data: {
        storageKey: blob.key,
        originalName,
        mimeType,
        sizeBytes: blob.sizeBytes,
        sha256: blob.sha256,
        purpose,
        uploadedById: user.id,
      },
      include: { uploadedBy: true },
    });
    return this.toView(row);
  }

  /**
   * Links staged attachments to an entity inside the caller's transaction. Each id must be
   * a non-deleted attachment uploaded by the actor, with an accepted purpose, and either
   * staged or already linked to the same entity. Failures are 422 on `attachmentIds.<i>`.
   */
  async link(tx: PrismaTx, input: LinkAttachmentsInput): Promise<void> {
    const field = input.field ?? 'attachmentIds';
    const ids = [...new Set(input.ids)];
    if (ids.length === 0) return;
    const rows = await tx.attachment.findMany({ where: { id: { in: ids } } });
    const errors: Record<string, string[]> = {};
    input.ids.forEach((id, index) => {
      const row = rows.find((r) => r.id === id);
      const problem = !row
        ? 'Attachment not found.'
        : row.deletedAt
          ? 'Attachment was deleted.'
          : row.uploadedById !== input.actor.id
            ? 'You can only attach files you uploaded.'
            : !input.purposes.includes(row.purpose)
              ? `Attachment purpose must be ${input.purposes.join(' or ')}.`
              : row.entityId && (row.entityId !== input.entityId || row.entityType !== input.entityType)
                ? 'Attachment is already linked elsewhere.'
                : null;
      if (problem) errors[`${field}.${index}`] = [problem];
    });
    if (Object.keys(errors).length) throw ProblemException.validation(errors);
    await tx.attachment.updateMany({
      where: { id: { in: ids }, entityId: null },
      data: { entityType: input.entityType, entityId: input.entityId, linkedAt: this.clock.now() },
    });
  }

  /** Attachments of an entity (not deleted), oldest first. */
  async listFor(entityType: string, entityId: string, db: PrismaTx = this.prisma): Promise<AttachmentView[]> {
    const rows = await db.attachment.findMany({
      where: { entityType, entityId, deletedAt: null },
      include: { uploadedBy: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => this.toView(row));
  }

  /** Soft delete (the purge job removes the binary after 30 days). */
  async softDelete(tx: PrismaTx, id: string): Promise<void> {
    await tx.attachment.update({ where: { id }, data: { deletedAt: this.clock.now() } });
  }

  /** Loads an attachment the user may see, else 404 (D5). */
  async findVisible(user: AuthUser, id: string): Promise<AttachmentRow> {
    const row = await this.prisma.attachment.findUnique({ where: { id }, include: { uploadedBy: true } });
    if (!row || row.deletedAt || !(await this.canView(user, row))) throw ProblemException.notFound('Attachment');
    return row;
  }

  async canView(user: AuthUser, row: { uploadedById: string; entityType: string | null; entityId: string | null }) {
    if (!row.entityType || !row.entityId) return row.uploadedById === user.id;
    const policy = this.providers.attachmentPolicyFor(row.entityType);
    if (!policy) return row.uploadedById === user.id;
    return policy.canView(user, row.entityType, row.entityId);
  }

  /** Signed, expiring download URL bound to attachment + user (default FILE_URL_TTL_SECONDS). */
  downloadUrl(
    user: AuthUser,
    attachmentId: string,
    disposition: 'inline' | 'attachment' = 'attachment',
    ttlSeconds = this.config.get('FILE_URL_TTL_SECONDS'),
  ): { url: string; expiresAt: string } {
    const { token, expiresAt } = this.storage.sign<DownloadToken>(
      { a: attachmentId, u: user.id, d: disposition },
      ttlSeconds,
      this.clock.now().getTime(),
    );
    const base = this.config.get('API_PUBLIC_URL').replace(/\/$/, '');
    return { url: `${base}/api/v1/files/${token}`, expiresAt: expiresAt.toISOString() };
  }

  /** Resolves a download token to a servable attachment, or null (-> 404). */
  async resolveToken(token: string): Promise<{ row: AttachmentRow; disposition: 'inline' | 'attachment' } | null> {
    const payload = this.storage.verify<DownloadToken>(token);
    if (!payload || typeof payload.a !== 'string') return null;
    const row = await this.prisma.attachment.findUnique({ where: { id: payload.a }, include: { uploadedBy: true } });
    if (!row || row.deletedAt || !(await this.storage.exists(row.storageKey))) return null;
    return { row, disposition: payload.d === 'inline' ? 'inline' : 'attachment' };
  }

  openRead(storageKey: string) {
    return this.storage.openRead(storageKey);
  }

  async deleteStaged(user: AuthUser, id: string): Promise<void> {
    const row = await this.prisma.attachment.findUnique({ where: { id } });
    if (!row || row.deletedAt || row.uploadedById !== user.id) throw ProblemException.notFound('Attachment');
    if (row.entityId)
      throw ProblemException.conflict('The attachment is linked; remove it through the owning resource.');
    await this.prisma.attachment.delete({ where: { id } });
    await this.storage.delete(row.storageKey);
  }

  toView(row: AttachmentRow): AttachmentView {
    return {
      id: row.id,
      originalName: row.originalName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      purpose: row.purpose,
      uploadedBy: toUserRef(row.uploadedBy),
      createdAt: row.createdAt.toISOString(),
    };
  }
}
