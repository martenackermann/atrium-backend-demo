import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AppConfig } from '@/config/app-config';

/** Structured JSON logging (pino) with the request id on every line; pretty output in development. */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => {
        const pretty = config.get('NODE_ENV') === 'development';
        return {
          pinoHttp: {
            level: config.isTest ? 'silent' : config.get('LOG_LEVEL'),
            // requestIdMiddleware (configureApp) runs first and sets req.id.
            genReqId: (req: IncomingMessage & { id?: unknown }) => (typeof req.id === 'string' ? req.id : randomUUID()),
            customProps: () => ({ app: 'atrium-api' }),
            redact: {
              paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
              censor: '[redacted]',
            },
            autoLogging: { ignore: (req: IncomingMessage) => req.url?.endsWith('/health') ?? false },
            transport: pretty
              ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:HH:MM:ss.l' } }
              : undefined,
          },
        };
      },
    }),
  ],
})
export class LoggingModule {}
