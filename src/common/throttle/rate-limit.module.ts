import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppConfig } from '@/config/app-config';
import { AUTH_THROTTLER, AuthRateLimitGuard } from './auth-rate-limit.guard';

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        throttlers: [{ name: AUTH_THROTTLER, ttl: 60_000, limit: config.get('AUTH_RATE_LIMIT_PER_MINUTE') }],
      }),
    }),
  ],
  // Imported before AuthCommonModule in AppModule, so this guard runs before JwtAuthGuard.
  providers: [{ provide: APP_GUARD, useClass: AuthRateLimitGuard }],
})
export class RateLimitModule {}
