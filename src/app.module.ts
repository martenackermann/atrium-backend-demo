import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ZodSerializerInterceptor } from 'nestjs-zod';
import { AuthzModule } from './common/authz/authz.module';
import { ProblemDetailsFilter } from './common/http/problem-details.filter';
import { AppValidationPipe } from './common/http/validation';
import { LoggingModule } from './common/logging/logging.module';
import { RateLimitModule } from './common/throttle/rate-limit.module';
import { ClockModule } from './common/time/clock.service';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './infra/health/health.module';
import { MailModule } from './infra/mail/mail.module';
import { QueueModule } from './infra/queue/queue.module';
import { StorageModule } from './infra/storage/storage.module';
import { AssetsModule } from './modules/assets/assets.module';
import { CoreAuthModule } from './modules/core/auth/core-auth.module';
import { CoreModule } from './modules/core/core.module';
import { CoreRegistryModule } from './modules/core/core-registry.module';
import { IdempotencyInterceptor } from './modules/core/idempotency/idempotency.interceptor';
import { HomeModule } from './modules/home/home.module';
import { NewsModule } from './modules/news/news.module';
import { PeopleModule } from './modules/people/people.module';
import { TrainingModule } from './modules/training/training.module';
import { TravelModule } from './modules/travel/travel.module';

@Module({
  imports: [
    // Infrastructure. Order matters for global guards: rate limit -> JWT auth -> abilities.
    AppConfigModule,
    ClockModule,
    LoggingModule,
    DatabaseModule,
    RateLimitModule,
    CoreAuthModule,
    AuthzModule,
    QueueModule,
    ScheduleModule.forRoot(),
    MailModule,
    StorageModule,
    CoreRegistryModule,
    HealthModule,

    // Feature modules (registry: one line per module).
    CoreModule,
    TrainingModule,
    TravelModule,
    AssetsModule,
    PeopleModule,
    NewsModule,
    HomeModule,
  ],
  providers: [
    { provide: APP_PIPE, useClass: AppValidationPipe },
    // Interceptors: first = outermost. Idempotency stores the serialised response.
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
