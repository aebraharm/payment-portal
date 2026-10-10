import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { HttpError } from '../lib/http.js';
import { createRateLimitStore } from '../lib/rateLimitStore.js';

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
    // Behind a proxy the Host header is the public domain; on Netlify the
    // forwarded host is authoritative, so prefer it when present.
    const forwardedHost = req.headers['x-forwarded-host'];
    const requestHost = config.isServerless && forwardedHost ? forwardedHost : req.headers.host;
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

/**
 * Pick the counter backend.
 *
 * `memory` is the express-rate-limit default and is correct for one long-lived
 * process. `db` shares windows through the database, which is required when the
 * app runs as many short-lived functions — an in-memory counter there is not a
 * limit, it is theatre. Config decides (see server/config.js), and
 * RATE_LIMIT_STORE can force either.
 */
function limiterOptions(label, { windowMs, limit, skip }) {
  return {
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: keyByIp,
    skip,
    // Always our store: it picks the memory or database backend per request, so
    // the choice cannot be frozen by the order modules happen to be imported in.
    store: createRateLimitStore({ label }),
    message: { error: { code: 'rate_limited', message: 'Too many attempts. Please try again later.' } },
  };
}

export function authLimiter() {
  return rateLimit(
    limiterOptions('auth', {
      windowMs: config.rateLimit.authWindowMs,
      // Dynamic limit so tests (and operators via env reload) can tune it.
      limit: () => config.rateLimit.authMax,
      skip: () => config.isTest && config.rateLimit.authMax > 1000,
    })
  );
}

export function generalLimiter() {
  return rateLimit(
    limiterOptions('general', {
      windowMs: config.rateLimit.generalWindowMs,
      limit: config.rateLimit.generalMax,
      skip: () => config.isTest,
    })
  );
}

export { keyByIp };
