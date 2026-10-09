import { HttpError } from '../lib/http.js';
import { config } from '../config.js';

export function notFoundHandler(req, res, next) {
  if (req.path.startsWith('/api/')) {
    return next(new HttpError(404, 'Endpoint not found.', 'not_found'));
  }
  next();
}

export function errorHandler(err, req, res, _next) {
  let status = 500;
  let code = 'internal_error';
  let message = 'An unexpected error occurred. Please try again.';
  let details;

  if (err instanceof HttpError) {
    status = err.status;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err?.name === 'MulterError') {
    status = 400;
    code = 'upload_error';
    message = err.message;
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    code = 'invalid_json';
    message = 'Request body must be valid JSON.';
  }

  if (status >= 500) {
    console.error('[error]', req.method, req.originalUrl, err);
  }

  res.status(status).json({
    error: {
      code,
      message,
      ...(details ? { details } : {}),
      ...(status >= 500 && !config.isProduction ? { stack: String(err?.stack || '') } : {}),
    },
  });
}
