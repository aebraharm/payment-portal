// Netlify Function entry point: the whole JSON API under /api/*.
//
// Everything real lives in the app (`server/app.js` + `server/lib/serverlessAdapter.js`)
// so the VPS deployment and this one run the same routes, middleware and
// security checks. Routing to this file is configured in netlify.toml, where the
// /api/* rule deliberately sits ABOVE the SPA fallback.

import { handleFetch } from '../../server/lib/serverlessAdapter.js';

export default async function handler(request, context) {
  return handleFetch(request, context);
}
