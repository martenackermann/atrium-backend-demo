/**
 * Shared vocabulary of the Atrium API (API.md §2.2). Import these constants instead of
 * repeating string literals; zod enums are built from them in `schemas.ts`.
 */

export const ROLE_NAMES = [
  'employee',
  'manager',
  'executive',
  'training_office',
  'travel_desk',
  'asset_admin',
  'people_ops',
  'news_editor',
  'it_admin',
] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

/** Roles stored in `user_roles` (employee is implicit, manager is derived). */
export const ASSIGNABLE_ROLES = [
  'executive',
  'training_office',
  'travel_desk',
  'asset_admin',
  'people_ops',
  'news_editor',
  'it_admin',
] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export const PERSONA_KEYS = ['emma', 'max', 'sofia', 'clara', 'tom', 'tina', 'arne', 'paula', 'ian'] as const;
export type PersonaKey = (typeof PERSONA_KEYS)[number];

export const MODULE_NAMES = ['core', 'training', 'travel', 'assets', 'people', 'news'] as const;
export type ModuleName = (typeof MODULE_NAMES)[number];

/** Modules that produce inbox items. */
export const INBOX_MODULES = ['training', 'travel', 'assets', 'people'] as const;
export type InboxModule = (typeof INBOX_MODULES)[number];

export const ACTING_AS = [
  'self',
  'requester',
  'approver',
  'deputy',
  'manager_chain',
  'executive',
  'back_office',
  'admin',
  'system',
] as const;
export type ActingAs = (typeof ACTING_AS)[number];

export const APPROVER_REASONS = [
  'direct_manager',
  'site_manager_escalation',
  'manager_unavailable',
  'executive_self',
  'fallback',
] as const;
export type ApproverReason = (typeof APPROVER_REASONS)[number];

export const AUTO_APPROVALS = ['executive_self', 'requester_is_approver', 'same_approver'] as const;
export type AutoApproval = (typeof AUTO_APPROVALS)[number];

export const ATTACHMENT_PURPOSES = [
  'training_document',
  'training_booking_document',
  'travel_booking_confirmation',
  'news_cover',
  'people_document',
] as const;
export type AttachmentPurpose = (typeof ATTACHMENT_PURPOSES)[number];

/**
 * Badge tones from DESIGN.md §2.4 (SPEC_RESOLUTIONS #8). `you` is applied client-side when the
 * viewer must act; enum options carry the default (viewer-independent) tone.
 */
export const TONES = ['neutral', 'waiting', 'you', 'moving', 'positive', 'negative', 'blocked'] as const;
export type Tone = (typeof TONES)[number];

export const NOTIFICATION_PRIORITIES = ['high', 'normal'] as const;
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];

export const APPROVAL_EXEMPTIONS = ['executive_traveller'] as const;
export type ApprovalExemptionCode = (typeof APPROVAL_EXEMPTIONS)[number];

/** Back-office role per module (used for actingAs = back_office). */
export const BACK_OFFICE_ROLE: Record<Exclude<ModuleName, 'core'>, AssignableRole> = {
  training: 'training_office',
  travel: 'travel_desk',
  assets: 'asset_admin',
  people: 'people_ops',
  news: 'news_editor',
};
