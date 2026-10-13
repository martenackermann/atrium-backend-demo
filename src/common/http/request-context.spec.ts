import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { RequestContext, requestIdMiddleware } from './request-context';

/** Runs `fn` inside a fresh HTTP request context, like the real middleware does. */
function inRequest<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const req = { headers: {} } as unknown as Request;
    const res = { setHeader: vi.fn() } as unknown as Response;
    const next: NextFunction = () => void fn().then(resolve, reject);
    requestIdMiddleware(req, res, next);
  });
}

describe('RequestContext.memo', () => {
  it('computes once per request and again in the next request', async () => {
    const factory = vi.fn(() => Promise.resolve(Math.random()));
    const [a, b] = await inRequest(() =>
      Promise.all([RequestContext.memo('k', factory), RequestContext.memo('k', factory)]),
    );
    expect(a).toBe(b);
    expect(factory).toHaveBeenCalledTimes(1);
    await inRequest(() => RequestContext.memo('k', factory));
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('recomputes after forget() and after a rejection', async () => {
    let calls = 0;
    const factory = () => (++calls === 1 ? Promise.reject(new Error('boom')) : Promise.resolve(calls));
    await inRequest(async () => {
      await expect(RequestContext.memo('k', factory)).rejects.toThrow('boom');
      expect(await RequestContext.memo('k', factory)).toBe(2);
      RequestContext.forget('k');
      expect(await RequestContext.memo('k', factory)).toBe(3);
    });
  });

  it('does not cache outside a request (jobs, direct service calls)', async () => {
    const factory = vi.fn(() => Promise.resolve(1));
    await RequestContext.memo('k', factory);
    await RequestContext.run('job-run', () => RequestContext.memo('k', factory));
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
