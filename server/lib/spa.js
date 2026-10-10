import express from 'express';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Static hosting for the built single-page app, mirroring what Netlify does
 * with `publish = "dist"` plus the `/*` fallback in `netlify.toml`.
 *
 * Order matters and is the whole point of this module:
 *   1. real files (hashed assets, favicon) are served directly;
 *   2. `/api/*` is passed back to the API stack via `next()` so a deep link can
 *      never shadow an endpoint and a missing endpoint still returns JSON 404;
 *   3. everything else returns `index.html`, so client-side routes such as
 *      `/admin/login` work on a direct visit or a refresh.
 */
export function createSpaMiddleware({ distDir }) {
  const indexFile = path.join(distDir, 'index.html');
  const router = express.Router();
  router.use(express.static(distDir));
  if (fs.existsSync(indexFile)) {
    router.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(indexFile);
    });
  }
  return router;
}
