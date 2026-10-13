import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PasswordHasher } from '@/common/auth/password-hasher';
import { AppConfig } from '@/config/app-config';
import { PrincipalService } from '../users/principal.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TokenService } from './token.service';

/**
 * Authentication plumbing: JWT + session check (global JwtAuthGuard), principal loading
 * and password hashing. Imported by AppModule BEFORE AuthzModule so the auth guard runs
 * before the ability guard.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        secret: config.get('JWT_SECRET'),
        signOptions: { algorithm: 'HS256', issuer: 'atrium' },
        verifyOptions: { algorithms: ['HS256'], issuer: 'atrium' },
      }),
    }),
  ],
  providers: [TokenService, PrincipalService, PasswordHasher, { provide: APP_GUARD, useClass: JwtAuthGuard }],
  exports: [TokenService, PrincipalService, PasswordHasher],
})
export class CoreAuthModule {}
