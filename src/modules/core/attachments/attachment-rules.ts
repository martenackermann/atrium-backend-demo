import type { AuthUser } from '@/common/auth/auth-user';
import { hasRole } from '@/common/auth/auth-user';
import type { AttachmentPurpose, RoleName } from '@/common/domain/vocabulary';
import { MIME } from '@/infra/storage/file-validation';

const DOCUMENTS = [MIME.pdf, MIME.png, MIME.jpeg, MIME.docx] as const;

/** SPEC §4.1: allowed MIME types (detected from magic bytes) per purpose. */
export const ALLOWED_MIME_BY_PURPOSE: Record<AttachmentPurpose, readonly string[]> = {
  training_document: DOCUMENTS,
  training_booking_document: DOCUMENTS,
  travel_booking_confirmation: [MIME.pdf],
  news_cover: [MIME.png, MIME.jpeg, MIME.webp],
  people_document: DOCUMENTS,
};

/** API.md §3.4: who may upload for a purpose (null = anyone). */
const UPLOAD_ROLES: Record<AttachmentPurpose, RoleName[] | null> = {
  training_document: null,
  training_booking_document: ['training_office', 'it_admin'],
  travel_booking_confirmation: ['travel_desk', 'it_admin'],
  news_cover: ['news_editor', 'it_admin'],
  people_document: null,
};

export function mayUpload(user: AuthUser, purpose: AttachmentPurpose): boolean {
  const roles = UPLOAD_ROLES[purpose];
  return roles === null || hasRole(user, ...roles);
}
