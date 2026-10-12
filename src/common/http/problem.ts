import { HttpException, HttpStatus } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** Base URI of Atrium's problem types. Types are stable identifiers, not fetchable pages. */
export const PROBLEM_TYPE_BASE = 'https://atrium.example.com/problems/';

/** Field-level validation messages keyed by dotted path ("address.city", "items.0.qty"). */
export type FieldErrors = Record<string, string[]>;

/** Key used in `errors` for problems that concern the whole payload rather than one field. */
export const ROOT_FIELD = '_root';

/** RFC 9457 problem details as emitted by every Atrium endpoint. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  /** Present on 422 validation problems. */
  errors?: FieldErrors;
  /** Correlates the response with server logs (also sent as X-Request-Id). */
  requestId?: string;
  [extension: string]: unknown;
}

/** Problem type slugs used across the API. Modules may add their own slugs. */
export const ProblemType = {
  badRequest: 'bad-request',
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  notFound: 'not-found',
  conflict: 'conflict',
  gone: 'gone',
  payloadTooLarge: 'payload-too-large',
  validation: 'validation-error',
  invalidTransition: 'invalid-transition',
  rateLimited: 'rate-limited',
  internal: 'internal-error',
  serviceUnavailable: 'service-unavailable',
  http: 'http-error',
} as const;

export function problemTypeUri(slug: string): string {
  return `${PROBLEM_TYPE_BASE}${slug}`;
}

export function statusTitle(status: number): string {
  return STATUS_CODES[status] ?? 'Error';
}

export interface ProblemInit {
  status: number;
  /** Slug from `ProblemType` (or a module-specific slug). */
  type?: string;
  title?: string;
  detail?: string;
  errors?: FieldErrors;
  /** Additional RFC 9457 extension members. */
  extensions?: Record<string, unknown>;
}

/**
 * Throw this from anywhere to produce a problem+json response. Prefer the static helpers.
 *
 * @example throw ProblemException.notFound('TrainingRequest', id)
 */
export class ProblemException extends HttpException {
  readonly problem: Required<Pick<ProblemInit, 'status' | 'type' | 'title'>> &
    Omit<ProblemInit, 'status' | 'type' | 'title'>;

  constructor(init: ProblemInit) {
    const title = init.title ?? statusTitle(init.status);
    super(init.detail ?? title, init.status);
    this.problem = { ...init, type: init.type ?? ProblemType.http, title };
  }

  static badRequest(detail: string): ProblemException {
    return new ProblemException({ status: HttpStatus.BAD_REQUEST, type: ProblemType.badRequest, detail });
  }

  static unauthorized(detail = 'Authentication is required.'): ProblemException {
    return new ProblemException({ status: HttpStatus.UNAUTHORIZED, type: ProblemType.unauthorized, detail });
  }

  static forbidden(detail = 'You are not allowed to perform this action.'): ProblemException {
    return new ProblemException({ status: HttpStatus.FORBIDDEN, type: ProblemType.forbidden, detail });
  }

  static notFound(resource: string, id?: string | number): ProblemException {
    const detail = id === undefined ? `${resource} not found.` : `${resource} "${id}" not found.`;
    return new ProblemException({ status: HttpStatus.NOT_FOUND, type: ProblemType.notFound, detail });
  }

  static conflict(detail: string, extensions?: Record<string, unknown>): ProblemException {
    return new ProblemException({
      status: HttpStatus.CONFLICT,
      type: ProblemType.conflict,
      detail,
      extensions,
    });
  }

  static gone(detail: string): ProblemException {
    return new ProblemException({ status: HttpStatus.GONE, type: ProblemType.gone, detail });
  }

  /** 422 with field errors, e.g. `ProblemException.validation({ email: ['Already taken'] })`. */
  static validation(errors: FieldErrors, detail = 'The request contains invalid data.'): ProblemException {
    return new ProblemException({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      type: ProblemType.validation,
      title: 'Validation failed',
      detail,
      errors,
    });
  }

  /** 409 for a workflow action that is not allowed in the entity's current state. */
  static invalidTransition(action: string, state: string): ProblemException {
    return new ProblemException({
      status: HttpStatus.CONFLICT,
      type: ProblemType.invalidTransition,
      title: 'Action not available',
      detail: `Action "${action}" is not available in state "${state}".`,
      extensions: { action, state },
    });
  }
}
