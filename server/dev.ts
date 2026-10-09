// API server for local development. Vite proxies /api requests here. It listens on 127.0.0.1 because only
// the Vite dev server (same machine) talks to it. The browser never calls this port directly.

import { serve } from '@hono/node-server';
import { createApp } from './http/app';
import { createDeps } from './runtime';
import { log } from './lib/logger';

const port = Number(process.env.API_PORT ?? 8787);
const deps = await createDeps();
const app = createApp(deps);

serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (info) => {
  log('info', 'dev-api.started', { port: info.port, database: deps.db.kind, storage: deps.storage.driver });
});
