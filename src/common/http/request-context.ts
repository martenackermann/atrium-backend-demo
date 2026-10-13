import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

interface RequestContextStore {
  /** Request id (X-Request-Id / traceId) or job run id. */
  correlationId: string;
  /** Per-HTTP-request memo (see `RequestContext.memo`); absent for job runs. */
  memo?: Map<string, Promise<unknown>>;
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
  /**
   * Computes `factory()` once per HTTP request and shares the promise with later calls in the
   * same request (e.g. the org snapshot behind every approval check of a list). Outside a
   * request (jobs, tests calling services directly) it just calls `factory()`. A rejected
   * result is not kept. Call `forget(key)` after writing data the value depends on.
   */
  memo<T>(key: string, factory: () => Promise<T>): Promise<T> {
    const memo = storage.getStore()?.memo;
    if (!memo) return factory();
    const cached = memo.get(key) as Promise<T> | undefined;
    if (cached) return cached;
    const promise = factory();
    memo.set(key, promise);
    promise.catch(() => {
      if (memo.get(key) === promise) memo.delete(key);
    });
    return promise;
  },
  forget(key: string): void {
    storage.getStore()?.memo?.delete(key);
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
  storage.run({ correlationId: id, memo: new Map() }, () => next());
}
