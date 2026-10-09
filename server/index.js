import { createApp } from './app.js';
import { migrate } from './migrate.js';
import { seedDatabase } from './seed.js';
import { config } from './config.js';

async function main() {
  migrate();
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
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`[server] Payment portal listening on http://0.0.0.0:${config.port} (${config.env})`);
  });
}

main().catch((err) => {
  console.error('[server] fatal startup error:', err);
  process.exit(1);
});
