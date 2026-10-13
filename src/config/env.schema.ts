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

const int = (fallback: number, min = 0) => z.coerce.number().int().min(min).default(fallback);
const cron = (fallback: string) => z.string().trim().min(9).default(fallback);
/** Empty string = unset (handy in .env files). */
const optionalString = z
  .string()
  .optional()
  .transform((value) => (value && value.trim() ? value.trim() : undefined));

/**
 * Every environment variable the API reads (SPEC.md §9), validated once at startup; the app
 * refuses to boot with an invalid configuration. Access values through `AppConfig`.
 * Slice settings live here too, so slices never need to edit this file.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),

  /** Frontend base URL, used for links in emails and notifications. */
  APP_BASE_URL: z.url().default('http://localhost:3000'),
  /** Public base URL of this API, used for signed download URLs. */
  API_PUBLIC_URL: z.url().default('http://localhost:3100'),
  /** Comma-separated allowlist (no wildcard). Default: the five local frontends (ports 3000-3004). */
  CORS_ORIGINS: commaList.default([
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    'http://localhost:3003',
    'http://localhost:3004',
  ]),
  APP_TIMEZONE: z.string().min(1).default('Europe/Berlin'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_TTL_MINUTES: int(480, 1),
  /** 64 hex characters (32 bytes) for AES-256-GCM (booking PINs). */
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be 64 hex characters')
    .default('0000000000000000000000000000000000000000000000000000000000000000'),
  FILE_SIGNING_SECRET: z.string().min(16).default('change-me-local-file-signing'),
  FILE_URL_TTL_SECONDS: int(300, 1),
  STORAGE_DIR: z.string().min(1).default('./storage'),
  UPLOAD_MAX_BYTES: int(10_485_760, 1),

  SMTP_HOST: z.string().min(1).default('127.0.0.1'),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  MAIL_FROM: z.string().min(3).default('Atrium <no-reply@example.com>'),
  MAILBOX_TRAVEL_DESK: z.email().default('travel-desk@example.com'),
  MAILBOX_TRAINING_OFFICE: z.email().default('training-office@example.com'),
  MAILBOX_PEOPLE_OPS: z.email().default('people-ops@example.com'),
  MAILBOX_IT_SUPPORT: z.email().default('it-support@example.com'),

  TRAINING_EXECUTIVE_THRESHOLD_CENTS: int(500_000),
  TRAINING_HIGH_PRIORITY_DAYS: int(14),
  RATING_LOOP1_DELAY_DAYS: int(1),
  RATING_LOOP2_DELAY_DAYS: int(60),
  RATING_LOOP3_DELAY_DAYS: int(30),
  RATING_REMINDER_CADENCE_DAYS: int(7, 1),
  RATING_REMINDER_MAX: int(4, 1),
  RATING_OVERDUE_DAYS: int(14),
  GOALS_REMINDER_DAYS_BEFORE: int(7),
  TRAVEL_HIGH_PRIORITY_DAYS: int(3),
  DEFAULT_COST_CENTER_CODE: z.string().min(1).default('CC-4900'),
  FALLBACK_APPROVER_EMAIL: z.email().default('clara.ceo@example.com'),
  ASSET_ACCEPTANCE_REMINDER_DAYS: int(3, 1),
  ASSET_ACCEPTANCE_REMINDER_MAX: int(3, 1),
  /** acceptanceOverdue = assignedAt + N days; also the inbox due date (SPEC_RESOLUTIONS #23). */
  ASSET_ACCEPTANCE_DUE_DAYS: int(7, 1),
  PEOPLE_REOPEN_WINDOW_DAYS: int(30),

  /** Login attempts per 15 minutes per email + IP. */
  LOGIN_RATE_LIMIT: int(10, 1),

  /** Enables /auth/personas and /auth/demo-login. */
  DEMO_MODE: booleanString.default(true),
  /** In DEMO_MODE the rating/goal reminder crons stay off unless this is true (SPEC_RESOLUTIONS #10). */
  ENABLE_REMINDER_CRONS: booleanString.default(false),
  /** Cron for the demo.reset job; unset = disabled. */
  DEMO_RESET_CRON: optionalString,
  SEED_FAKER_SEED: int(4711),
  /** IsoDate the seed treats as "today"; unset = today in APP_TIMEZONE. */
  SEED_TODAY: optionalString.pipe(z.iso.date().optional()),

  CRON_TRAINING_RATINGS: cron('15 7 * * *'),
  CRON_TRAINING_GOALS: cron('20 7 * * *'),
  CRON_TRAVEL_DIGEST: cron('30 7 * * 1-5'),
  CRON_ASSETS_COST_CENTER: cron('0 2 * * *'),
  CRON_ASSETS_ACCEPTANCE: cron('40 7 * * 1-5'),
  CRON_NEWS: cron('*/5 * * * *'),
  CRON_CORE_PURGE: cron('10 3 * * *'),
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
