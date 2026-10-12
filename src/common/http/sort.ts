import { z } from 'zod';
import { ProblemException } from './problem';

export type SortDirection = 'asc' | 'desc';

export interface SortField {
  field: string;
  direction: SortDirection;
}

/** Prisma `orderBy` entry, e.g. `{ createdAt: 'desc' }` or `{ owner: { lastName: 'asc' } }`. */
export type OrderBy = Record<string, unknown>;

export class SortParseError extends Error {}

/**
 * Parses `a,-b` into `[{ field: 'a', direction: 'asc' }, { field: 'b', direction: 'desc' }]`.
 * Throws `SortParseError` for empty segments, duplicates or fields outside `allowed`.
 */
export function parseSort(raw: string | undefined | null, allowed: readonly string[]): SortField[] {
  if (raw === undefined || raw === null || raw.trim() === '') return [];
  const seen = new Set<string>();
  return raw.split(',').map((segment) => {
    const token = segment.trim();
    const desc = token.startsWith('-');
    const field = desc || token.startsWith('+') ? token.slice(1) : token;
    if (!field) throw new SortParseError('Empty sort field.');
    if (!allowed.includes(field)) {
      throw new SortParseError(`Cannot sort by "${field}". Allowed: ${allowed.join(', ')}.`);
    }
    if (seen.has(field)) throw new SortParseError(`Duplicate sort field "${field}".`);
    seen.add(field);
    return { field, direction: desc ? 'desc' : 'asc' };
  });
}

/**
 * Converts parsed sort fields to a Prisma `orderBy` array. Dotted fields become nested
 * relations; `fieldMap` maps public names to Prisma paths (`{ manager: 'manager.lastName' }`).
 */
export function toPrismaOrderBy(fields: readonly SortField[], fieldMap: Record<string, string> = {}): OrderBy[] {
  return fields.map(({ field, direction }) => {
    const path = (fieldMap[field] ?? field).split('.');
    return path.reduceRight<unknown>((acc, key) => ({ [key]: acc }), direction) as OrderBy;
  });
}

export interface SortParamOptions {
  /** Public field names clients may sort by. */
  allowed: readonly [string, ...string[]];
  /** Applied when `sort` is absent, e.g. "-createdAt". */
  default?: string;
}

/**
 * Zod schema for a `?sort=` query parameter with an allowlist. Parses to `SortField[]`;
 * invalid values become a 422 problem with `errors.sort`.
 *
 * @example
 * const listQuery = paginationQuerySchema.extend({
 *   sort: sortParam({ allowed: ['createdAt', 'title'], default: '-createdAt' }),
 * });
 */
export function sortParam(options: SortParamOptions) {
  const description = `Comma-separated fields; prefix with "-" for descending. Allowed: ${options.allowed.join(', ')}.`;
  return z
    .string()
    .optional()
    .describe(description)
    .transform((value, ctx) => {
      try {
        return parseSort(value ?? options.default, options.allowed);
      } catch (error) {
        ctx.addIssue({ code: 'custom', message: (error as Error).message });
        return z.NEVER;
      }
    });
}

/** For service code that receives a raw sort string: throws a 422 problem on invalid input. */
export function parseSortOrThrow(raw: string | undefined, allowed: readonly string[]): SortField[] {
  try {
    return parseSort(raw, allowed);
  } catch (error) {
    throw ProblemException.validation({ sort: [(error as Error).message] });
  }
}
