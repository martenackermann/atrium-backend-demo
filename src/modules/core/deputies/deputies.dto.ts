import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { isoDateSchema, isoDateTimeSchema, userRefSchema } from '@/common/domain/schemas';

const optionalDate = isoDateSchema.nullish().transform((v) => v ?? null);
const optionalNote = z
  .string()
  .trim()
  .max(200)
  .nullish()
  .transform((v) => (v ? v : null));

export const createDeputySchema = z.strictObject({
  /** it_admin only: create the deputy for another principal (SPEC_RESOLUTIONS #24). */
  principalId: z.uuid().optional(),
  deputyId: z.uuid(),
  validFrom: optionalDate,
  validTo: optionalDate,
  note: optionalNote,
});
export class CreateDeputyDto extends createZodDto(createDeputySchema) {}

export const updateDeputySchema = z.strictObject({
  validFrom: isoDateSchema.nullish(),
  validTo: isoDateSchema.nullish(),
  note: optionalNote.optional(),
});
export class UpdateDeputyDto extends createZodDto(updateDeputySchema) {}

export const deputySchema = z.object({
  id: z.uuid(),
  principal: userRefSchema,
  deputy: userRefSchema,
  validFrom: isoDateSchema.nullable(),
  validTo: isoDateSchema.nullable(),
  note: z.string().nullable(),
  isActiveNow: z.boolean(),
  state: z.enum(['active', 'upcoming', 'expired']),
  createdAt: isoDateTimeSchema,
});
export class DeputyDto extends createZodDto(deputySchema) {}

export class MyDeputiesDto extends createZodDto(
  z.object({ asPrincipal: z.array(deputySchema), asDeputy: z.array(deputySchema) }),
) {}
