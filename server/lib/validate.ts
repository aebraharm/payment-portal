import type { z } from 'zod';
import { unprocessable } from './errors';

export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || '_form';
    out[key] ??= issue.message;
  }
  return out;
}

/** Parses untrusted input. Throws a 422 with per-field messages instead of a raw zod error. */
export function parseInput<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw unprocessable('Please correct the highlighted fields.', fieldErrors(result.error));
  }
  return result.data;
}

export function clean(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
