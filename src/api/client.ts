export class ApiError extends Error {
  code: string;
  status: number;
  details?: Array<{ path?: string; message: string }>;

  constructor(status: number, code: string, message: string, details?: Array<{ path?: string; message: string }>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  formData?: FormData;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

/**
 * Thin fetch wrapper. Sessions are HttpOnly cookies, so credentials are always
 * included for same-origin requests. Errors are normalized into ApiError.
 */
export async function apiFetch<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  if (options.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }

  const res = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body,
    credentials: 'same-origin',
    signal: options.signal,
  });

  const contentType = res.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const err = payload?.error || {};
    throw new ApiError(res.status, err.code || 'error', err.message || `Request failed (${res.status}).`, err.details);
  }
  return payload as T;
}

export const api = {
  get: <T = unknown>(path: string, signal?: AbortSignal) => apiFetch<T>(path, { signal }),
  post: <T = unknown>(path: string, body?: unknown, opts: { idempotencyKey?: string; signal?: AbortSignal } = {}) =>
    apiFetch<T>(path, { method: 'POST', body, ...opts }),
  postForm: <T = unknown>(path: string, formData: FormData, opts: { idempotencyKey?: string; signal?: AbortSignal } = {}) =>
    apiFetch<T>(path, { method: 'POST', formData, ...opts }),
  put: <T = unknown>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PUT', body }),
  del: <T = unknown>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'DELETE', body }),
};
