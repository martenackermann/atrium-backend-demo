import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { isoDateTimeSchema, personaKeySchema, roleNameSchema } from '@/common/domain/schemas';
import { meSchema } from '../users/users.dto';

export const loginSchema = z.strictObject({
  email: z.string().trim().toLowerCase().min(3).max(200),
  password: z.string().min(1).max(200),
});
export class LoginDto extends createZodDto(loginSchema) {}

export const demoLoginSchema = z.strictObject({ personaKey: personaKeySchema });
export class DemoLoginDto extends createZodDto(demoLoginSchema) {}

export const loginResponseSchema = z.object({
  accessToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresAt: isoDateTimeSchema,
  user: meSchema,
});
export class LoginResponseDto extends createZodDto(loginResponseSchema) {}

export const personaSchema = z.object({
  key: personaKeySchema,
  displayName: z.string(),
  email: z.string(),
  jobTitle: z.string(),
  department: z.string(),
  roles: z.array(roleNameSchema),
  tagline: z.string(),
  highlights: z.array(z.string()),
});
export class PersonaDto extends createZodDto(personaSchema) {}
