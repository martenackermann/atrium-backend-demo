import { z } from 'zod';

const booleanString = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0', 'yes', 'no'])])
  .transform((value) => (typeof value === 'boolean' ? value : ['true', '1', 'yes'].includes(value)));

const commaList = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
);

/**
 * Every environment variable the API reads. Validated once at startup; the app refuses
 * to boot with an invalid configuration. Access values through `AppConfig`.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  /** Token lifetime: seconds ("3600") or a duration with unit s/m/h/d ("8h"). */
  JWT_TTL: z
    .string()
    .regex(/^\d+[smhd]?$/, 'JWT_TTL must look like 3600, 15m, 8h or 7d')
    .default('8h'),
  /** Max requests per minute and client IP against /api/v1/auth/*. */
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(20),

  SMTP_HOST: z.string().min(1).default('127.0.0.1'),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  MAIL_FROM: z.string().min(3).default('Atrium <no-reply@example.com>'),

  APP_URL: z.url().default('http://localhost:3100'),
  FRONTEND_URL: z.url().default('http://localhost:3000'),
  CORS_ORIGINS: commaList.default(['http://localhost:3000']),

  DEMO_MODE: booleanString.default(true),
  STORAGE_DIR: z.string().min(1).default('./storage'),
});

export type Env = z.infer<typeof envSchema>;

/** Used by ConfigModule.forRoot({ validate }). Throws a readable error listing every problem. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}
