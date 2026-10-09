import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { HttpError } from '../lib/http.js';

export function helmetMiddleware() {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });
}

/**
 * CSRF defense-in-depth: cookies are SameSite=Strict, and for state-changing
 * requests we additionally verify that an Origin header, when present,
 * matches the request host.
 */
export function originCheck(req, res, next) {
  const method = req.method;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
  const origin = req.headers.origin;
  if (!origin) return next(); // non-browser client
  try {
    const originHost = new URL(origin).host;
    const requestHost = req.headers.host;
    if (originHost !== requestHost) {
      return next(new HttpError(403, 'Cross-origin request blocked.', 'csrf_blocked'));
    }
  } catch {
    return next(new HttpError(400, 'Invalid Origin header.', 'bad_request'));
  }
  next();
}

function keyByIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

export function authLimiter() {
  return rateLimit({
    windowMs: config.rateLimit.authWindowMs,
    // Dynamic limit so tests (and operators via env reload) can tune it.
    limit: () => config.rateLimit.authMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: keyByIp,
    message: { error: { code: 'rate_limited', message: 'Too many attempts. Please try again later.' } },
    skip: () => config.isTest && config.rateLimit.authMax > 1000,
  });
}

export function generalLimiter() {
  return rateLimit({
    windowMs: config.rateLimit.generalWindowMs,
    max: config.rateLimit.generalMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: keyByIp,
    skip: () => config.isTest,
  });
}
