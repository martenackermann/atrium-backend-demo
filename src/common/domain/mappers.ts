import type { z } from 'zod';
import type { refSchema, userRefSchema, userSummarySchema } from './schemas';

export type Ref = z.infer<typeof refSchema>;
export type UserRef = z.infer<typeof userRefSchema>;
export type UserSummary = z.infer<typeof userSummarySchema>;

/** Minimal user shape the mappers need (a Prisma `User` row satisfies it). */
export interface UserLike {
  id: string;
  displayName: string;
  email: string;
  jobTitle: string | null;
  firstName?: string;
  lastName?: string;
}

export function initialsOf(user: Pick<UserLike, 'displayName' | 'firstName' | 'lastName'>): string {
  if (user.firstName && user.lastName) return `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase();
  const parts = user.displayName.trim().split(/\s+/);
  return `${parts[0]?.[0] ?? ''}${parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : ''}`.toUpperCase();
}

export function toUserRef(user: UserLike): UserRef {
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    jobTitle: user.jobTitle,
    initials: initialsOf(user),
  };
}

export function toUserRefOrNull(user: UserLike | null | undefined): UserRef | null {
  return user ? toUserRef(user) : null;
}

export function toRef(row: { id: string; code: string; name: string }): Ref {
  return { id: row.id, code: row.code, name: row.name };
}

export function toRefOrNull(row: { id: string; code: string; name: string } | null | undefined): Ref | null {
  return row ? toRef(row) : null;
}

export function toUserSummary(
  user: UserLike & {
    active: boolean;
    department: { id: string; code: string; name: string } | null;
    site: { id: string; code: string; name: string } | null;
  },
): UserSummary {
  return {
    ...toUserRef(user),
    department: toRefOrNull(user.department),
    site: toRefOrNull(user.site),
    active: user.active,
  };
}

/** Prisma `include` that loads what `toUserSummary` needs. */
export const userSummaryInclude = { department: true, site: true } as const;

/** Money helpers (D2): integer cents, always EUR. */
export const money = (amountCents: number) => ({ amountCents, currency: 'EUR' as const });
