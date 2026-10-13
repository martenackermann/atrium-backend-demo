import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

interface RequestContextStore {
  /** Request id (X-Request-Id / traceId) or job run id. */
  correlationId: string;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

export const REQUEST_ID_HEADER = 'x-request-id';
const VALID_REQUEST_ID = /^[\w.:-]{1,128}$/;

/**
 * Correlation id of the current request or job run (audit `correlationId`, problem
 * `traceId`). Returns 'system' outside of any context.
 */
export const RequestContext = {
  correlationId(): string {
    return storage.getStore()?.correlationId ?? 'system';
  },
  /** Runs `fn` with a correlation id (used by the job runner). */
  run<T>(correlationId: string, fn: () => T): T {
    return storage.run({ correlationId }, fn);
  },
};

/**
 * First middleware: reuses a sane incoming X-Request-Id or creates one, echoes it on the
 * response, stores it on `req.id` (picked up by pino) and opens the async context.
 */
export function requestIdMiddleware(req: Request & { id?: unknown }, res: Response, next: NextFunction): void {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id = typeof incoming === 'string' && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  storage.run({ correlationId: id }, () => next());
}
