// Imported first by rate-limit.e2e-spec.ts: ConfigModule validates env when AppModule is imported.
process.env.LOGIN_RATE_LIMIT = '3';
// A direct client (no proxy): X-Forwarded-For must not choose the rate-limit bucket.
process.env.TRUST_PROXY = 'false';

export {};
