import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { PROBLEM_CONTENT_TYPE } from './problem';

const DESCRIPTIONS: Record<number, string> = {
  400: 'Bad request',
  401: 'Not authenticated',
  403: 'Not allowed',
  404: 'Not found',
  409: 'Conflict (e.g. action not available in current state)',
  410: 'Gone',
  413: 'Payload too large',
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
  description: 'RFC 9457 problem details',
  required: ['type', 'title', 'status'],
  properties: {
    type: { type: 'string', format: 'uri', example: 'https://atrium.example.com/problems/validation-error' },
    title: { type: 'string', example: 'Validation failed' },
    status: { type: 'integer', example: 422 },
    detail: { type: 'string' },
    instance: { type: 'string', example: '/api/v1/example' },
    requestId: { type: 'string' },
    errors: {
      type: 'object',
      description: 'Field errors keyed by dotted path (422 only). "_root" holds payload-level errors.',
      additionalProperties: { type: 'array', items: { type: 'string' } },
    },
  },
} as const;
