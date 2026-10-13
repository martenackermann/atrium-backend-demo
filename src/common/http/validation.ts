import { createZodValidationPipe } from 'nestjs-zod';
import { ProblemException } from './problem';
import { configureZod, isZodErrorLike, zodIssuesToFieldErrors } from './zod-errors';

configureZod();

/**
 * Global validation pipe: validates every `createZodDto` body/query/params and turns
 * failures into 422 problem+json with field errors.
 */
export const AppValidationPipe = createZodValidationPipe({
  createValidationException: (error: unknown) =>
    isZodErrorLike(error)
      ? ProblemException.validation(zodIssuesToFieldErrors(error.issues))
      : ProblemException.validation({ _root: ['Invalid request.'] }),
});
