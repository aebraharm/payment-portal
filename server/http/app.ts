// Application factory. The same app runs under the Netlify Functions adapter, the Node server and tests.

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import type { Context } from 'hono';
import type { Deps } from '../deps';
import { AppError } from '../lib/errors';
import { errorFields, log } from '../lib/logger';
import { clientIp, type AppEnv } from './context';
import { adminAuthRoutes, adminDataRoutes } from './routes/admin';
import { clientAuthRoutes, clientDataRoutes } from './routes/client';
import { publicRoutes } from './routes/public';
import { internalRoutes } from './routes/internal';

function errorBody(error: AppError) {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
      ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
    },
  };
}

export function createApp(deps: Deps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', secureHeaders({ referrerPolicy: 'no-referrer', crossOriginResourcePolicy: 'same-origin', xFrameOptions: 'DENY' }));
  app.use('/api/*', async (c, next) => {
    c.set('ip', clientIp(c, deps.config.trustProxyHeaders));
    await next();
    if (!c.res.headers.has('Cache-Control')) c.res.headers.set('Cache-Control', 'no-store');
  });

  app.onError((error: Error, c: Context<AppEnv>) => {
    if (error instanceof AppError) {
      const response = c.json(errorBody(error), error.status as 400);
      if (error.retryAfterSeconds) response.headers.set('Retry-After', String(error.retryAfterSeconds));
      return response;
    }
    if (error instanceof HTTPException) return error.getResponse();
    log('error', 'request.failed', { method: c.req.method, path: new URL(c.req.url).pathname, ...errorFields(error) });
    return c.json({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } }, 500);
  });

  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'We could not find that page.' } }, 404));

  app.get('/api/health', async (c) => {
    try {
      await deps.db.query('SELECT 1');
      return c.json({ status: 'ok' });
    } catch {
      return c.json({ status: 'degraded' }, 503);
    }
  });

  app.route('/api/public', publicRoutes(deps));
  app.route('/api/admin', adminAuthRoutes(deps));
  app.route('/api/admin', adminDataRoutes(deps));
  app.route('/api/client', clientAuthRoutes(deps));
  app.route('/api/client', clientDataRoutes(deps));
  app.route('/api/internal', internalRoutes(deps));

  return app;
}
