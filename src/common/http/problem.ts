import { HttpException, HttpStatus } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** Base URI of Atrium's problem types: `type` = base + `code`. Identifiers, not fetchable pages. */
export const PROBLEM_TYPE_BASE = 'https://atrium.example.com/problems/';

/** Error codes (API.md §2.4). Closed list - add new codes there first. */
export const ERROR_CODES = [
  'validation_failed',
  'unauthenticated',
  'invalid_credentials',
  'forbidden',
  'not_found',
  'invalid_transition',
  'version_conflict',
  'conflict',
  'serial_taken',
  'model_in_use',
  'in_use',
  'deputy_overlap',
  'payload_too_large',
  'unsupported_media_type',
  'idempotency_key_reused',
  'rate_limited',
  'internal_error',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Field-level validation messages keyed by dot path with numeric indices (`attendees.0.userId`). */
export type FieldErrors = Record<string, string[]>;

/** Key used in `errors` for problems that concern the whole payload rather than one field. */
export const ROOT_FIELD = '_root';

/** RFC 9457 problem details as emitted by every Atrium endpoint (API.md §2.4). */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code: ErrorCode;
  /** = X-Request-Id */
  traceId?: string;
  /** Only for 422. */
  errors?: FieldErrors;
  [extension: string]: unknown;
}

export function problemTypeUri(code: ErrorCode): string {
  return `${PROBLEM_TYPE_BASE}${code}`;
}

export function statusTitle(status: number): string {
  return STATUS_CODES[status] ?? 'Error';
}

export interface ProblemInit {
  status: number;
  code: ErrorCode;
  title?: string;
  detail?: string;
  errors?: FieldErrors;
  /** Additional RFC 9457 extension members. */
  extensions?: Record<string, unknown>;
}

/**
 * Throw this from anywhere to produce a problem+json response. Prefer the static helpers.
 *
 * @example throw ProblemException.notFound('Training request')
 */
export class ProblemException extends HttpException {
  readonly problem: ProblemInit & { title: string };

  constructor(init: ProblemInit) {
    const title = init.title ?? statusTitle(init.status);
    super(init.detail ?? title, init.status);
    this.problem = { ...init, title };
  }

  static unauthenticated(detail = 'Authentication is required.'): ProblemException {
    return new ProblemException({ status: HttpStatus.UNAUTHORIZED, code: 'unauthenticated', detail });
  }

  static invalidCredentials(): ProblemException {
    return new ProblemException({
      status: HttpStatus.UNAUTHORIZED,
      code: 'invalid_credentials',
      title: 'Invalid credentials',
      detail: 'Email or password is incorrect.',
    });
  }

  static forbidden(detail = 'You are not allowed to perform this action.'): ProblemException {
    return new ProblemException({ status: HttpStatus.FORBIDDEN, code: 'forbidden', detail });
  }

  /** 404 - also used for resources the user may not see (D5). */
  static notFound(what = 'Resource'): ProblemException {
    return new ProblemException({ status: HttpStatus.NOT_FOUND, code: 'not_found', detail: `${what} not found.` });
  }

  static conflict(
    detail: string,
    code: ErrorCode = 'conflict',
    extensions?: Record<string, unknown>,
  ): ProblemException {
    return new ProblemException({ status: HttpStatus.CONFLICT, code, detail, extensions });
  }

  static versionConflict(): ProblemException {
    return new ProblemException({
      status: HttpStatus.CONFLICT,
      code: 'version_conflict',
      title: 'Version conflict',
      detail: 'The resource was changed by someone else. Reload and try again.',
    });
  }

  /** 409 for a workflow action that is not allowed in the entity's current state. */
  static invalidTransition(action: string, state: string): ProblemException {
    return new ProblemException({
      status: HttpStatus.CONFLICT,
      code: 'invalid_transition',
      title: 'Action not available',
      detail: `Action '${action}' is not available in state '${state}'.`,
    });
  }

  /** 422 with field errors, e.g. `ProblemException.validation({ email: ['Already taken'] })`. */
  static validation(errors: FieldErrors, detail = 'The request contains invalid data.'): ProblemException {
    return new ProblemException({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      code: 'validation_failed',
      title: 'Validation failed',
      detail,
      errors,
    });
  }

  /** Shortcut for a single field error. */
  static fieldError(field: string, message: string): ProblemException {
    return ProblemException.validation({ [field]: [message] });
  }

  static payloadTooLarge(detail: string): ProblemException {
    return new ProblemException({ status: HttpStatus.PAYLOAD_TOO_LARGE, code: 'payload_too_large', detail });
  }

  static unsupportedMediaType(detail: string): ProblemException {
    return new ProblemException({
      status: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      code: 'unsupported_media_type',
      detail,
    });
  }
}
