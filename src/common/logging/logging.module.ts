import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AppConfig } from '@/config/app-config';

export const REQUEST_ID_HEADER = 'x-request-id';
const VALID_REQUEST_ID = /^[\w.:-]{1,128}$/;

/** Reuses a sane incoming X-Request-Id or creates one; echoes it on the response. */
export function requestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id = typeof incoming === 'string' && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', id);
  return id;
}

/** Structured JSON logging (pino) with a request id on every line; pretty output in development. */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => {
        const pretty = config.get('NODE_ENV') === 'development';
        return {
          pinoHttp: {
            level: config.isTest ? 'silent' : config.get('LOG_LEVEL'),
            genReqId: requestId,
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
