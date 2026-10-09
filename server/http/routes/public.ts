// Public, unauthenticated read endpoints. Only published branding assets are served.

import { Hono } from 'hono';
import type { Deps } from '../../deps';
import { notFound } from '../../lib/errors';
import { getBrandingAsset } from '../../services/branding';
import { publicConfig } from '../../services/publicConfig';
import { readPublished } from '../../services/settings';
import type { AppEnv } from '../context';

export function publicRoutes(deps: Deps) {
  const router = new Hono<AppEnv>();

  router.get('/config', async (c) => {
    c.header('Cache-Control', 'no-cache');
    return c.json(await publicConfig(deps));
  });

  router.get('/assets/:id', async (c) => {
    const id = c.req.param('id');
    const settings = await readPublished(deps.db);
    const published = [settings.branding.logoAssetId, settings.branding.faviconAssetId];
    if (!published.includes(id)) throw notFound('We could not find that file.');
    const asset = await getBrandingAsset(deps.db, id);
    if (!asset) throw notFound('We could not find that file.');
    c.header('Content-Type', asset.contentType);
    c.header('Cache-Control', 'public, max-age=300');
    c.header('ETag', `"${asset.sha256}"`);
    c.header('X-Content-Type-Options', 'nosniff');
    return c.body(asset.data as unknown as ArrayBuffer, 200);
  });

  return router;
}
