export class HttpError extends Error {
  constructor(status, message, code = 'error', details = undefined) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}

export const badRequest = (message, details) => new HttpError(400, message, 'bad_request', details);
export const unauthorized = (message = 'Authentication required.') =>
  new HttpError(401, message, 'unauthorized');
export const forbidden = (message = 'You are not authorized to perform this action.') =>
  new HttpError(403, message, 'forbidden');
export const notFound = (message = 'Resource not found.') => new HttpError(404, message, 'not_found');
export const conflict = (message) => new HttpError(409, message, 'conflict');

/** Wrap an async route handler so rejections reach the error middleware. */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/** Zod error → HttpError(400) with per-field details. */
export function zodError(error) {
  const details = error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
  return new HttpError(400, 'Validation failed. Please check the highlighted fields.', 'validation_error', details);
}
