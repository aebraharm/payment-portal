import { createApp } from './app.js';
import { ensureMigrated } from './migrate.js';
import { seedDatabase } from './seed.js';
import { config, assertProductionConfig } from './config.js';

async function main() {
  assertProductionConfig();
  await ensureMigrated();
  await seedDatabase();

  let spaHandler;
  if (!config.isProduction) {
    // Development: run Vite in middleware mode so one process serves the API
    // and the frontend (with HMR) on a single port.
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    spaHandler = vite.middlewares;
    console.log('[dev] Vite middleware mode enabled');
  }

  const app = createApp({ spaHandler });
  const host = config.host;
  app.listen(config.port, host, () => {
    console.log(`[server] Payment portal listening on http://${host}:${config.port} (${config.env})`);
    if (config.isProduction && host !== '127.0.0.1' && host !== '::1') {
      console.warn(
        '[server] WARNING: production is bound to a non-loopback address. ' +
          'Prefer the default HOST=127.0.0.1 behind a reverse proxy so the API is not directly reachable.'
      );
    }
  });
}

main().catch((err) => {
  console.error('[server] fatal startup error:', err);
  process.exit(1);
});
