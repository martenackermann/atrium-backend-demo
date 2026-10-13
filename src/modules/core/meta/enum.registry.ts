import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { toneSchema } from '@/common/domain/schemas';
import type { Tone } from '@/common/domain/vocabulary';

export const enumOptionSchema = z
  .object({
    value: z.union([z.string(), z.number()]),
    label: z.string(),
    tone: toneSchema.nullable(),
    description: z.string().nullable(),
  })
  .meta({ id: 'EnumOption' });

export type EnumOption = z.infer<typeof enumOptionSchema>;

/** 'in_person' -> 'In person' (API.md §3.6 "sentence-case of the value"). */
export function sentenceCase(value: string | number): string {
  const text = String(value).replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Builds enum options. Labels default to sentence case; pass overrides as
 * `{ value: 'Label' }` or `{ value: ['Label', 'tone'] }`.
 *
 * @example enumOptions(['to_book', 'booked'], { to_book: ['To book', 'warning'], booked: ['Booked', 'success'] })
 */
export function enumOptions(
  values: readonly (string | number)[],
  overrides: Record<string, string | [string, Tone | null] | [string, Tone | null, string]> = {},
): EnumOption[] {
  return values.map((value) => {
    const override = overrides[String(value)];
    if (override === undefined) return { value, label: sentenceCase(value), tone: null, description: null };
    if (typeof override === 'string') return { value, label: override, tone: null, description: null };
    return { value, label: override[0], tone: override[1], description: override[2] ?? null };
  });
}

/** Feeds `GET /meta/enums`. Register with `CoreExtensionsModule.forFeature({ enums })`. */
@Injectable()
export class EnumRegistry {
  private readonly enums = new Map<string, EnumOption[]>();

  register(name: string, options: EnumOption[]): void {
    if (this.enums.has(name)) throw new Error(`Enum "${name}" is registered twice`);
    this.enums.set(name, options);
  }

  get(name: string): EnumOption[] | undefined {
    return this.enums.get(name);
  }

  all(): Record<string, EnumOption[]> {
    return Object.fromEntries([...this.enums.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }
}
