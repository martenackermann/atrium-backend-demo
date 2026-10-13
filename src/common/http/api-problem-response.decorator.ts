import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { ERROR_CODES, PROBLEM_CONTENT_TYPE } from './problem';

const DESCRIPTIONS: Record<number, string> = {
  400: 'Bad request',
  401: 'Not authenticated',
  403: 'Not allowed',
  404: 'Not found',
  409: 'Conflict (e.g. action not available in current state)',
  413: 'Payload too large',
  415: 'Unsupported media type',
  422: 'Validation failed (see `errors`)',
  429: 'Rate limited',
};

/** Documents problem+json error responses: `@ApiProblemResponses(404, 422)`. */
export function ApiProblemResponses(...statuses: number[]): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({
        status,
        description: DESCRIPTIONS[status] ?? 'Error',
        content: { [PROBLEM_CONTENT_TYPE]: { schema: { $ref: '#/components/schemas/ProblemDetails' } } },
      }),
    ),
  );
}

/** JSON schema for ProblemDetails, added to `components.schemas` by the OpenAPI builder. */
export const PROBLEM_DETAILS_OPENAPI_SCHEMA = {
  type: 'object',
  description: 'RFC 9457 problem details (API.md §2.4)',
  required: ['type', 'title', 'status', 'code', 'traceId'],
  properties: {
    type: { type: 'string', format: 'uri', example: 'https://atrium.example.com/problems/validation_failed' },
    title: { type: 'string', example: 'Validation failed' },
    status: { type: 'integer', example: 422 },
    detail: { type: 'string' },
    instance: { type: 'string', example: '/api/v1/me/deputies' },
    code: { type: 'string', enum: [...ERROR_CODES] },
    traceId: { type: 'string', description: 'Same value as the X-Request-Id response header' },
    errors: {
      type: 'object',
      description: 'Field errors keyed by dot path (422 only). "_root" holds payload-level errors.',
      additionalProperties: { type: 'array', items: { type: 'string' } },
    },
  },
};
