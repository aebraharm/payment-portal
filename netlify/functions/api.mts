// Netlify Function: serves the whole JSON API under /api/*. The database and storage connections are
// created once per warm instance and reused across requests.

import { createApp } from '../../server/http/app';
import { getRuntime } from '../../server/runtime';

let appPromise: Promise<ReturnType<typeof createApp>> | null = null;

function getApp() {
  appPromise ??= getRuntime().then((deps) => createApp(deps));
  return appPromise;
}

export default async (request: Request): Promise<Response> => {
  const app = await getApp();
  return app.fetch(request);
};

export const config = {
  path: '/api/*',
};
