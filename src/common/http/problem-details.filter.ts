import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Prisma } from '@/generated/prisma/client';
import {
  PROBLEM_CONTENT_TYPE,
  ProblemException,
  type ProblemDetails,
  ProblemType,
  problemTypeUri,
  statusTitle,
} from './problem';
import { isZodErrorLike, zodIssuesToFieldErrors } from './zod-errors';

/**
 * Turns every error into an RFC 9457 `application/problem+json` response.
 * Registered globally (APP_FILTER) in AppModule.
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
    if (request.id !== undefined) problem.requestId = String(request.id);

    if (problem.status >= 500) {
      this.logger.error(
        { err: exception, requestId: problem.requestId },
        exception instanceof Error ? exception.message : 'Unhandled error',
      );
    }

    if (response.headersSent) return;
    response.status(problem.status).type(PROBLEM_CONTENT_TYPE).send(JSON.stringify(problem));
  }

  toProblem(exception: unknown): ProblemDetails {
    if (exception instanceof ProblemException) {
      const { status, type, title, detail, errors, extensions } = exception.problem;
      return { type: problemTypeUri(type), title, status, detail, ...(errors ? { errors } : {}), ...extensions };
    }

    if (isZodErrorLike(exception)) {
      return this.build(HttpStatus.UNPROCESSABLE_ENTITY, ProblemType.validation, {
        title: 'Validation failed',
        detail: 'The request contains invalid data.',
        errors: zodIssuesToFieldErrors(exception.issues),
      });
    }

    if (exception instanceof ThrottlerException) {
      return this.build(HttpStatus.TOO_MANY_REQUESTS, ProblemType.rateLimited, {
        detail: 'Too many requests. Please retry later.',
      });
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return this.build(status, this.slugForStatus(status), { detail: this.httpDetail(exception) });
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = this.fromPrisma(exception);
      if (mapped) return mapped;
    }

    return this.build(HttpStatus.INTERNAL_SERVER_ERROR, ProblemType.internal, {
      detail: 'An unexpected error occurred.',
    });
  }

  private build(
    status: number,
    slug: string,
    extra: { title?: string; detail?: string; errors?: Record<string, string[]> },
  ): ProblemDetails {
    const { title, ...rest } = extra;
    return { type: problemTypeUri(slug), title: title ?? statusTitle(status), status, ...rest };
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

  private slugForStatus(status: number): string {
    switch (status) {
      case 400:
        return ProblemType.badRequest;
      case 401:
        return ProblemType.unauthorized;
      case 403:
        return ProblemType.forbidden;
      case 404:
        return ProblemType.notFound;
      case 409:
        return ProblemType.conflict;
      case 410:
        return ProblemType.gone;
      case 413:
        return ProblemType.payloadTooLarge;
      case 422:
        return ProblemType.validation;
      case 429:
        return ProblemType.rateLimited;
      case 503:
        return ProblemType.serviceUnavailable;
      default:
        return status >= 500 ? ProblemType.internal : ProblemType.http;
    }
  }

  private fromPrisma(error: Prisma.PrismaClientKnownRequestError): ProblemDetails | undefined {
    switch (error.code) {
      case 'P2025': // record required but not found
        return this.build(HttpStatus.NOT_FOUND, ProblemType.notFound, { detail: 'Resource not found.' });
      case 'P2002': {
        // unique constraint
        const target = (error.meta?.target as string[] | string | undefined) ?? [];
        const fields = Array.isArray(target) ? target : [target];
        return this.build(HttpStatus.CONFLICT, ProblemType.conflict, {
          detail: fields.length ? `A record with this ${fields.join(', ')} already exists.` : 'Duplicate record.',
        });
      }
      case 'P2003': // foreign key
        return this.build(HttpStatus.CONFLICT, ProblemType.conflict, {
          detail: 'The operation conflicts with related records.',
        });
      default:
        return undefined;
    }
  }
}
