import { createHmac } from 'node:crypto';
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { from, type Observable, of, switchMap } from 'rxjs';
import { ProblemException } from '@/common/http/problem';
import { AppConfig } from '@/config/app-config';
import { PrismaService } from '@/database/prisma.service';
import { Prisma } from '@/generated/prisma/client';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
const VALID_KEY = /^[\w-]{8,128}$/;
const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Keyed fingerprint of method, path and body. An HMAC, not a plain hash: bodies can carry
 * low-entropy secrets (a booking PIN) that a plain SHA-256 in `idempotency_keys` would expose
 * to brute force by anyone who can read the database.
 */
function hashRequest(key: Buffer, req: Request): string {
  return createHmac('sha256', key)
    .update(`${req.method} ${req.path}\n${JSON.stringify(req.body ?? null)}`)
    .digest('hex');
}

/**
 * D16 / API.md §1: every authenticated POST may carry `Idempotency-Key`. The first 2xx
 * response is stored for 24 h; a retry with the same key, path and body replays it with
 * `Idempotent-Replayed: true`; the same key with a different request is 422
 * `idempotency_key_reused`. Applied globally (APP_INTERCEPTOR).
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly hashKey: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    config: AppConfig,
  ) {
    this.hashKey = createHmac('sha256', config.get('JWT_SECRET')).update('atrium:idempotency').digest();
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const key = req.headers[IDEMPOTENCY_HEADER];
    if (req.method !== 'POST' || typeof key !== 'string' || !req.user) return next.handle();
    if (!VALID_KEY.test(key)) {
      throw ProblemException.fieldError('Idempotency-Key', 'Use 8-128 letters, digits, "-" or "_" (a UUID).');
    }
    const userId = req.user.id;
    const requestHash = hashRequest(this.hashKey, req);

    return from(this.prisma.idempotencyKey.findUnique({ where: { userId_key: { userId, key } } })).pipe(
      switchMap((stored) => {
        if (stored && stored.createdAt.getTime() > Date.now() - TTL_MS) {
          if (stored.requestHash !== requestHash || stored.path !== req.path) {
            throw new ProblemException({
              status: 422,
              code: 'idempotency_key_reused',
              title: 'Idempotency key reused',
              detail: 'This Idempotency-Key was already used for a different request.',
            });
          }
          res.status(stored.responseStatus);
          res.setHeader('Idempotent-Replayed', 'true');
          return of(stored.responseBody);
        }
        return next.handle().pipe(
          switchMap((body: unknown) =>
            from(
              this.prisma.idempotencyKey
                .upsert({
                  where: { userId_key: { userId, key } },
                  create: {
                    userId,
                    key,
                    method: req.method,
                    path: req.path,
                    requestHash,
                    responseStatus: res.statusCode,
                    responseBody:
                      body === undefined || body === null ? Prisma.JsonNull : (body as Prisma.InputJsonValue),
                  },
                  update: {
                    method: req.method,
                    path: req.path,
                    requestHash,
                    responseStatus: res.statusCode,
                    responseBody:
                      body === undefined || body === null ? Prisma.JsonNull : (body as Prisma.InputJsonValue),
                    createdAt: new Date(),
                  },
                })
                .then(() => body),
            ),
          ),
        );
      }),
    );
  }
}
