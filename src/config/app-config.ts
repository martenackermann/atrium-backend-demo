import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Env, envSchema } from './env.schema';

/** Typed, validated access to environment configuration. Inject this instead of ConfigService. */
@Injectable()
export class AppConfig {
  constructor(private readonly config: ConfigService<Env, true>) {}

  /**
   * Validated value. Optional variables left empty in .env come back as undefined (ConfigService
   * would fall back to the raw empty string from process.env).
   */
  get<K extends keyof Env>(key: K): Env[K] {
    const value = this.config.get(key, { infer: true });
    return (value === '' ? undefined : value) as Env[K];
  }

  /** The whole validated configuration (e.g. for the in-process seed). */
  snapshot(): Env {
    return Object.fromEntries(Object.keys(envSchema.shape).map((key) => [key, this.get(key as keyof Env)])) as Env;
  }

  get isProduction(): boolean {
    return this.get('NODE_ENV') === 'production';
  }

  get isTest(): boolean {
    return this.get('NODE_ENV') === 'test';
  }
}
