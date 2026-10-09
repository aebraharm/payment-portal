import { ApiError } from '../lib/api';

/** Maps a server validation error (HTTP 422 with per-field details) onto the form's field errors. */
export function fieldErrorsFrom(error: unknown): Record<string, string> {
  if (error instanceof ApiError && error.details) return error.details;
  return {};
}

export function formMessageFrom(error: unknown, fallback = 'Something went wrong. Please try again.'): string | null {
  if (error instanceof ApiError) {
    if (error.details && Object.keys(error.details).length > 0) return 'Please correct the highlighted fields.';
    if (error.status === 429 && error.retryAfterSeconds) {
      const minutes = Math.max(1, Math.ceil(error.retryAfterSeconds / 60));
      return `Too many attempts. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`;
    }
    return error.message || fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

export function todayLocalIso(): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** Copies text to the clipboard. Returns false when the browser blocks clipboard access. */
export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
