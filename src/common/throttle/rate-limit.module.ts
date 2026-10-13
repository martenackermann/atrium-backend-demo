import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppConfig } from '@/config/app-config';
import { AUTH_THROTTLER, AuthRateLimitGuard, LOGIN_WINDOW_MS, loginLimitFor } from './auth-rate-limit.guard';

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => {
        const limit = config.get('LOGIN_RATE_LIMIT');
        return {
          throttlers: [
            { name: AUTH_THROTTLER, ttl: LOGIN_WINDOW_MS, limit: (context) => loginLimitFor(context, limit) },
          ],
        };
      },
    }),
  ],
  // Imported before the core module in AppModule, so this guard runs before JwtAuthGuard.
  providers: [{ provide: APP_GUARD, useClass: AuthRateLimitGuard }],
})
export class RateLimitModule {}
