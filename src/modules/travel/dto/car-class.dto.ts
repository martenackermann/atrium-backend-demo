import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { optionalTextSchema } from '@/common/domain/schemas';
import { vehicleTypeSchema } from './travel-request.dto';

export const carRentalClassSchema = z
  .object({
    id: z.uuid(),
    code: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    exampleModels: z.string().nullable(),
    vehicleType: vehicleTypeSchema,
    isDefault: z.boolean(),
    sortOrder: z.number().int(),
    active: z.boolean(),
  })
  .meta({ id: 'CarRentalClass' });
export type CarRentalClassView = z.infer<typeof carRentalClassSchema>;

export class CarRentalClassDto extends createZodDto(z.object(carRentalClassSchema.shape)) {}
export class CarRentalClassListDto extends createZodDto(z.array(carRentalClassSchema)) {}

const fields = {
  /** 4-letter, industry-style code (e.g. ECMR). */
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{4}$/, 'Use a 4-letter code, e.g. ECMR'),
  name: z.string().trim().min(2).max(80),
  description: optionalTextSchema(500),
  exampleModels: optionalTextSchema(200),
  vehicleType: vehicleTypeSchema,
  /** true clears the previous default of the vehicle type. */
  isDefault: z.boolean(),
  sortOrder: z.number().int().min(0).max(9999),
  active: z.boolean(),
};

export const createCarClassSchema = z.strictObject({
  ...fields,
  isDefault: fields.isDefault.default(false),
  sortOrder: fields.sortOrder.default(0),
  active: fields.active.default(true),
});
export class CreateCarClassDto extends createZodDto(createCarClassSchema) {}
export type CreateCarClassInput = z.infer<typeof createCarClassSchema>;

export const updateCarClassSchema = z.strictObject({
  code: fields.code.optional(),
  name: fields.name.optional(),
  description: optionalTextSchema(500).optional(),
  exampleModels: optionalTextSchema(200).optional(),
  vehicleType: fields.vehicleType.optional(),
  isDefault: fields.isDefault.optional(),
  sortOrder: fields.sortOrder.optional(),
  active: fields.active.optional(),
});
export class UpdateCarClassDto extends createZodDto(updateCarClassSchema) {}
export type UpdateCarClassInput = z.infer<typeof updateCarClassSchema>;

export const listCarClassesQuerySchema = z.object({
  vehicleType: vehicleTypeSchema.optional(),
  /** Back office only; ignored for everyone else. */
  includeInactive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export class ListCarClassesQuery extends createZodDto(listCarClassesQuerySchema) {}
