// Node server for self-hosting and `npm start`. It serves the API and the built single-page app.
// Serverless deployments use netlify/functions instead.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { createApp } from './http/app';
import { getRuntime } from './runtime';
import { log } from './lib/logger';
import type { AppEnv } from './http/context';

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '0.0.0.0';

const deps = await getRuntime();
const api = createApp(deps);
const app = new Hono<AppEnv>();
app.route('/', api);

// Same protections Netlify applies to the static app (see netlify.toml).
const APP_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
app.use('*', async (c, next) => {
  await next();
  if (!c.req.path.startsWith('/api/')) {
    c.header('Content-Security-Policy', APP_CSP);
    c.header('X-Frame-Options', 'DENY');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
  }
});

const distDir = path.resolve('dist');
if (existsSync(distDir)) {
  app.use('/assets/*', serveStatic({ root: distDir }));
  app.use('/*', serveStatic({ root: distDir }));
  app.get('*', async (c) => {
    if (c.req.path.startsWith('/api/')) return c.json({ error: { code: 'NOT_FOUND', message: 'We could not find that page.' } }, 404);
    const html = await readFile(path.join(distDir, 'index.html'), 'utf8');
    return c.html(html);
  });
}

serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  log('info', 'server.started', { port: info.port, host, database: deps.db.kind, storage: deps.storage.driver });
});
