import { z } from 'zod';
import { type FieldErrors, ROOT_FIELD } from './problem';

/** Converts zod issues to `{ "path.to.field": ["message", ...] }`. */
export function zodIssuesToFieldErrors(issues: readonly z.core.$ZodIssue[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join('.') : ROOT_FIELD;
    (errors[key] ??= []).push(issue.message);
  }
  return errors;
}

let configured = false;

/**
 * Global zod configuration: friendlier messages for missing values. Idempotent; called
 * by the validation pipe factory so every entry point (app, tests, scripts) shares it.
 */
export function configureZod(): void {
  if (configured) return;
  configured = true;
  z.config({
    customError: (issue) => {
      if (issue.code === 'invalid_type' && issue.input === undefined) return 'Required';
      return undefined;
    },
  });
}

/** True for zod errors from any zod flavour (classic, mini, core). */
export function isZodErrorLike(error: unknown): error is { issues: z.core.$ZodIssue[] } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'issues' in error &&
    Array.isArray(error.issues) &&
    (error as { name?: unknown }).name === 'ZodError'
  );
}
