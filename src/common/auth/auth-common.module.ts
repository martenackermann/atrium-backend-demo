import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AppConfig } from '@/config/app-config';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordHasher } from './password-hasher';
import { TokenService } from './token.service';

/**
 * Authentication plumbing shared by all modules: JWT signing/verification, the global
 * JwtAuthGuard and password hashing. Login/personas are implemented by the core module.
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
  providers: [TokenService, PasswordHasher, { provide: APP_GUARD, useClass: JwtAuthGuard }],
  exports: [TokenService, PasswordHasher],
})
export class AuthCommonModule {}
