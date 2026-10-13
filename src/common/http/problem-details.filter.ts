import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Prisma } from '@/generated/prisma/client';
import {
  type ErrorCode,
  PROBLEM_CONTENT_TYPE,
  ProblemException,
  type ProblemDetails,
  problemTypeUri,
  statusTitle,
} from './problem';
import { isZodErrorLike, zodIssuesToFieldErrors } from './zod-errors';

const CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: 'validation_failed',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  405: 'not_found',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  422: 'validation_failed',
  429: 'rate_limited',
};

/**
 * Turns every error into an RFC 9457 `application/problem+json` response with `code` and
 * `traceId` (API.md §2.4). No stack traces leave the server. Registered as APP_FILTER.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request & { id?: string | number }>();
    const response = ctx.getResponse<Response>();

    const problem = this.toProblem(exception);
    problem.instance = request.originalUrl?.split('?')[0] ?? request.url;
    if (request.id !== undefined) problem.traceId = String(request.id);

    if (problem.status >= 500) {
      this.logger.error(
        { err: exception, traceId: problem.traceId },
        exception instanceof Error ? exception.message : 'Unhandled error',
      );
    }

    if (response.headersSent) return;
    response.status(problem.status).type(PROBLEM_CONTENT_TYPE).send(JSON.stringify(problem));
  }

  toProblem(exception: unknown): ProblemDetails {
    if (exception instanceof ProblemException) {
      const { status, code, title, detail, errors, extensions } = exception.problem;
      return {
        type: problemTypeUri(code),
        title,
        status,
        detail,
        code,
        ...(errors ? { errors } : {}),
        ...extensions,
      };
    }

    if (isZodErrorLike(exception)) {
      return this.build(HttpStatus.UNPROCESSABLE_ENTITY, 'validation_failed', {
        title: 'Validation failed',
        detail: 'The request contains invalid data.',
        errors: zodIssuesToFieldErrors(exception.issues),
      });
    }

    if (exception instanceof ThrottlerException) {
      return this.build(HttpStatus.TOO_MANY_REQUESTS, 'rate_limited', {
        detail: 'Too many requests. Please retry later.',
      });
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = CODE_BY_STATUS[status] ?? (status >= 500 ? 'internal_error' : 'conflict');
      return this.build(status, code, {
        detail: status >= 500 ? 'An unexpected error occurred.' : this.httpDetail(exception),
      });
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = this.fromPrisma(exception);
      if (mapped) return mapped;
    }

    return this.build(HttpStatus.INTERNAL_SERVER_ERROR, 'internal_error', {
      detail: 'An unexpected error occurred.',
    });
  }

  private build(
    status: number,
    code: ErrorCode,
    extra: { title?: string; detail?: string; errors?: Record<string, string[]> },
  ): ProblemDetails {
    const { title, ...rest } = extra;
    return { type: problemTypeUri(code), title: title ?? statusTitle(status), status, code, ...rest };
  }

  private httpDetail(exception: HttpException): string | undefined {
    const body = exception.getResponse();
    if (typeof body === 'string') return body;
    if (typeof body === 'object' && body !== null && 'message' in body) {
      const message = body.message;
      if (Array.isArray(message)) return message.join('; ');
      if (typeof message === 'string') return message;
    }
    return exception.message;
  }

  private fromPrisma(error: Prisma.PrismaClientKnownRequestError): ProblemDetails | undefined {
    switch (error.code) {
      case 'P2025': // record required but not found
        return this.build(HttpStatus.NOT_FOUND, 'not_found', { detail: 'Resource not found.' });
      case 'P2002': {
        // unique constraint
        const target = (error.meta?.target as string[] | string | undefined) ?? [];
        const fields = Array.isArray(target) ? target : [target];
        return this.build(HttpStatus.CONFLICT, 'conflict', {
          detail: fields.length ? `A record with this ${fields.join(', ')} already exists.` : 'Duplicate record.',
        });
      }
      case 'P2003': // foreign key
        return this.build(HttpStatus.CONFLICT, 'conflict', {
          detail: 'The operation conflicts with related records.',
        });
      default:
        return undefined;
    }
  }
}
