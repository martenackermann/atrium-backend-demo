import { Global, Injectable, Module } from '@nestjs/common';
import { AppConfig } from '@/config/app-config';
import { type IsoDate, isoDateInZone } from './time';

/**
 * "Now" and "today" (in APP_TIMEZONE). Inject this instead of calling `new Date()` in
 * business rules so tests can pin time with `clock.set(...)`.
 */
@Injectable()
export class Clock {
  private fixed: Date | null = null;

  constructor(private readonly config: AppConfig) {}

  get timeZone(): string {
    return this.config.get('APP_TIMEZONE');
  }

  now(): Date {
    return this.fixed ? new Date(this.fixed) : new Date();
  }

  today(): IsoDate {
    return isoDateInZone(this.now(), this.timeZone);
  }

  /** Test helper: freeze time (pass null to unfreeze). */
  set(instant: Date | null): void {
    this.fixed = instant;
  }
}

@Global()
@Module({ providers: [Clock], exports: [Clock] })
export class ClockModule {}
