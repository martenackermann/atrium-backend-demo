import { ParseUUIDPipe } from '@nestjs/common';
import { ProblemException } from './problem';

/**
 * `@Param('id', UuidPipe) id: string` - a malformed id answers 404 (API.md §1), not 400.
 */
export const UuidPipe = new ParseUUIDPipe({ exceptionFactory: () => ProblemException.notFound() });
