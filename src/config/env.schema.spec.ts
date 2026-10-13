import { describe, expect, it, vi } from 'vitest';
import { productionSecretProblems, validateEnv } from './env.schema';

const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };
const strong = {
  JWT_SECRET: 'Jw7fQ2pL9xV4mZ8rT1cK6hN3bY5sD0aE',
  FILE_SIGNING_SECRET: 'Fs3kP8qW1zX6vB9nM2cL7jH4gT0rY5uA',
  ENCRYPTION_KEY: '3f9a1c7e5b2d8f4a6c0e9b1d7f3a5c8e2b4d6f8a0c1e3b5d7f9a2c4e6b8d0f1a',
};
const placeholders = {
  JWT_SECRET: 'change-me-local-only',
  // FILE_SIGNING_SECRET and ENCRYPTION_KEY fall back to the schema's placeholder defaults
};

describe('production secrets', () => {
  it('refuses placeholder secrets with NODE_ENV=production and DEMO_MODE=false', () => {
    const run = () => validateEnv({ ...base, ...placeholders, NODE_ENV: 'production', DEMO_MODE: 'false' });
    for (const key of ['JWT_SECRET', 'FILE_SIGNING_SECRET', 'ENCRYPTION_KEY']) expect(run).toThrow(key);
  });

  it('refuses short or reused secrets and a single-digit key', () => {
    expect(productionSecretProblems({ ...strong, JWT_SECRET: 'a'.repeat(31) })).toEqual([
      expect.stringContaining('JWT_SECRET: must be at least 32'),
    ]);
    expect(productionSecretProblems({ ...strong, FILE_SIGNING_SECRET: strong.JWT_SECRET })).toEqual([
      expect.stringContaining('FILE_SIGNING_SECRET: must differ'),
    ]);
    expect(productionSecretProblems({ ...strong, ENCRYPTION_KEY: 'f'.repeat(64) })).toEqual([
      expect.stringContaining('ENCRYPTION_KEY'),
    ]);
    expect(productionSecretProblems({ ...strong, JWT_SECRET: 'docker-demo-secret-change-me-0123456789' })).toEqual([
      expect.stringContaining('JWT_SECRET: is a placeholder'),
    ]);
  });

  it('boots with strong secrets in production', () => {
    const warn = vi.fn();
    const env = validateEnv({ ...base, ...strong, NODE_ENV: 'production', DEMO_MODE: 'false' }, warn);
    expect(env.NODE_ENV).toBe('production');
    expect(warn).not.toHaveBeenCalled();
  });

  it('only warns for a DEMO_MODE deployment (docker compose up without configuration)', () => {
    const warn = vi.fn();
    expect(() => validateEnv({ ...base, ...placeholders, NODE_ENV: 'production' }, warn)).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('JWT_SECRET, FILE_SIGNING_SECRET, ENCRYPTION_KEY'));
  });

  it('does not check secrets outside production', () => {
    const warn = vi.fn();
    expect(() => validateEnv({ ...base, ...placeholders, DEMO_MODE: 'false' }, warn)).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('HTTP settings', () => {
  const env = (extra: Record<string, string>) => validateEnv({ ...base, ...placeholders, ...extra });

  it('rejects a wildcard CORS origin', () => {
    expect(() => env({ CORS_ORIGINS: 'http://localhost:3000,*' })).toThrow('CORS_ORIGINS');
  });

  it('trusts only a proxy on the same host by default and parses TRUST_PROXY', () => {
    expect(env({}).TRUST_PROXY).toBe('loopback');
    expect(env({ TRUST_PROXY: 'false' }).TRUST_PROXY).toBe(false);
    expect(env({ TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1);
    expect(env({ TRUST_PROXY: 'loopback, uniquelocal' }).TRUST_PROXY).toBe('loopback, uniquelocal');
  });
});
