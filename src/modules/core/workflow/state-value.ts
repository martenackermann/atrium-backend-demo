import type { StateValue } from 'xstate';

/** `{ review: 'manager' }` -> "review.manager". Parallel states are not supported for persistence. */
export function stateValueToString(value: StateValue): string {
  if (typeof value === 'string') return value;
  const keys = Object.keys(value);
  if (keys.length !== 1) throw new Error('Parallel state values cannot be persisted as a single string');
  const key = keys[0];
  const child = value[key];
  return child === undefined || (typeof child === 'object' && Object.keys(child).length === 0)
    ? key
    : `${key}.${stateValueToString(child)}`;
}
