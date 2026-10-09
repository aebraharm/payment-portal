// Application errors. Messages are safe to show to users; internal details never are.

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, string> | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    options: { details?: Record<string, string>; retryAfterSeconds?: number } = {},
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = options.details;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export const badRequest = (message: string) => new AppError(400, 'BAD_REQUEST', message);
export const unauthorized = (message = 'Please sign in to continue.') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have permission to do this.') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'We could not find that item.') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (message: string) => new AppError(409, 'CONFLICT', message);
export const unprocessable = (message: string, details?: Record<string, string>) =>
  new AppError(422, 'VALIDATION_ERROR', message, { details });
export const tooManyRequests = (message: string, retryAfterSeconds: number) =>
  new AppError(429, 'RATE_LIMITED', message, { retryAfterSeconds });
export const serviceUnavailable = (message: string) => new AppError(503, 'UNAVAILABLE', message);
