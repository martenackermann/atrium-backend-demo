import { HttpException, NotFoundException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Prisma } from '@/generated/prisma/client';
import { pageMeta, paginate, paginationQuerySchema, toSkipTake } from './pagination';
import { ProblemException } from './problem';
import { ProblemDetailsFilter } from './problem-details.filter';
import { parseSort, parseSortOrThrow, sortParam, toPrismaOrderBy } from './sort';
import { configureZod, zodIssuesToFieldErrors } from './zod-errors';

describe('pagination', () => {
  it('defaults and coerces query strings', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, perPage: 25 });
    expect(paginationQuerySchema.parse({ page: '3', perPage: '50' })).toEqual({ page: 3, perPage: 50 });
    expect(paginationQuerySchema.safeParse({ perPage: '101' }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });

  it('computes skip/take and meta', () => {
    expect(toSkipTake({ page: 3, perPage: 10 })).toEqual({ skip: 20, take: 10 });
    expect(pageMeta(45, { page: 1, perPage: 20 })).toEqual({ page: 1, perPage: 20, total: 45, totalPages: 3 });
    expect(pageMeta(0, { page: 1, perPage: 20 }).totalPages).toBe(0);
  });

  it('paginate() runs page and count queries', async () => {
    const result = await paginate(
      { page: 2, perPage: 2 },
      ({ skip, take }) => Promise.resolve([skip, take]),
      () => Promise.resolve(5),
    );
    expect(result).toEqual({ data: [2, 2], meta: { page: 2, perPage: 2, total: 5, totalPages: 3 } });
  });
});

describe('sort', () => {
  const allowed = ['title', 'createdAt', 'owner.lastName'];

  it('parses directions and keeps order', () => {
    expect(parseSort('title,-createdAt', allowed)).toEqual([
      { field: 'title', direction: 'asc' },
      { field: 'createdAt', direction: 'desc' },
    ]);
    expect(parseSort(undefined, allowed)).toEqual([]);
    expect(parseSort(' ', allowed)).toEqual([]);
  });

  it('rejects unknown, empty and duplicate fields', () => {
    expect(() => parseSort('password', allowed)).toThrow(/Cannot sort by "password"/);
    expect(() => parseSort('title,', allowed)).toThrow(/Empty/);
    expect(() => parseSort('title,-title', allowed)).toThrow(/Duplicate/);
    expect(() => parseSortOrThrow('nope', allowed)).toThrow(ProblemException);
  });

  it('builds nested Prisma orderBy objects', () => {
    expect(toPrismaOrderBy(parseSort('-owner.lastName,title', allowed))).toEqual([
      { owner: { lastName: 'desc' } },
      { title: 'asc' },
    ]);
    expect(toPrismaOrderBy([{ field: 'manager', direction: 'asc' }], { manager: 'manager.displayName' })).toEqual([
      { manager: { displayName: 'asc' } },
    ]);
  });

  it('sortParam() applies the default and reports issues on "sort"', () => {
    const schema = z.object({ sort: sortParam({ allowed: ['title'], default: '-title' }) });
    expect(schema.parse({})).toEqual({ sort: [{ field: 'title', direction: 'desc' }] });
    const result = schema.safeParse({ sort: 'x' });
    expect(result.success).toBe(false);
    expect(zodIssuesToFieldErrors(result.error!.issues)).toEqual({ sort: [expect.stringContaining('Allowed: title')] });
  });
});

describe('zod field errors', () => {
  it('keys errors by dotted path and uses "_root" for the payload itself', () => {
    configureZod();
    const schema = z.object({ items: z.array(z.object({ qty: z.number() })), name: z.string() });
    const result = schema.safeParse({ items: [{ qty: 'x' }] });
    expect(zodIssuesToFieldErrors(result.error!.issues)).toEqual({
      'items.0.qty': [expect.any(String)],
      name: ['Required'],
    });
    const root = z.string().safeParse(5);
    expect(Object.keys(zodIssuesToFieldErrors(root.error!.issues))).toEqual(['_root']);
  });
});

describe('ProblemDetailsFilter.toProblem', () => {
  const filter = new ProblemDetailsFilter();

  it('maps ProblemException with extensions', () => {
    expect(filter.toProblem(ProblemException.invalidTransition('approve', 'draft'))).toEqual({
      type: 'https://atrium.example.com/problems/invalid_transition',
      title: 'Action not available',
      status: 409,
      code: 'invalid_transition',
      detail: "Action 'approve' is not available in state 'draft'.",
    });
    expect(filter.toProblem(ProblemException.conflict('Taken', 'serial_taken', { serial: 'X1' }))).toMatchObject({
      type: 'https://atrium.example.com/problems/serial_taken',
      code: 'serial_taken',
      serial: 'X1',
    });
  });

  it('maps Nest HTTP exceptions, throttling and zod errors', () => {
    expect(filter.toProblem(new NotFoundException('Cannot GET /x'))).toMatchObject({
      status: 404,
      code: 'not_found',
      title: 'Not Found',
      detail: 'Cannot GET /x',
    });
    expect(filter.toProblem(new HttpException('teapot', 418))).toMatchObject({
      status: 418,
      code: 'conflict',
    });
    expect(filter.toProblem(new ThrottlerException())).toMatchObject({ status: 429, code: 'rate_limited' });
    const zodError = z.object({ a: z.string() }).safeParse({}).error;
    expect(filter.toProblem(zodError)).toMatchObject({
      status: 422,
      code: 'validation_failed',
      errors: { a: [expect.any(String)] },
    });
  });

  it('maps Prisma unique/not-found errors and hides unknown errors', () => {
    const known = (code: string, meta?: Record<string, unknown>) =>
      new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: 'test', meta });
    expect(filter.toProblem(known('P2002', { target: ['email'] }))).toMatchObject({
      status: 409,
      detail: 'A record with this email already exists.',
    });
    expect(filter.toProblem(known('P2025'))).toMatchObject({ status: 404 });
    expect(filter.toProblem(new Error('secret internals'))).toEqual({
      type: 'https://atrium.example.com/problems/internal_error',
      title: 'Internal Server Error',
      status: 500,
      code: 'internal_error',
      detail: 'An unexpected error occurred.',
    });
  });
});
