import { randomUUID } from 'node:crypto';
import { createApp } from '../app.js';
import { ensureMigrated } from '../migrate.js';
import { assertProductionConfig, config } from '../config.js';

/**
 * Bridges one Express request/response cycle to the fetch `Request`/`Response`
 * pair that Netlify Functions v2 speak.
 *
 * It lives in `server/` rather than in `netlify/functions/` for two reasons: the
 * app must stay runnable on a VPS without Netlify's runtime, and the mapping is
 * the part of this migration most likely to be subtly wrong, so it needs to be
 * importable by the test suite. `netlify/functions/api.js` is a four-line shim
 * over `handleFetch()`.
 */

export const API_PREFIX = '/api';
const FUNCTION_PATH = /^\/\.netlify\/functions\/[A-Za-z0-9_-]+/;

/**
 * Turn whatever path the host hands us into a path the Express app owns.
 *
 * Depending on how the function is routed, the event path is either the URL the
 * browser asked for (`/api/health`) or the internal function URL after the
 * rewrite (`/.netlify/functions/api/health`). Express mounts its routers under
 * `/api`, so both have to land on `/api/...` — otherwise every endpoint 404s in
 * production while working perfectly in every test.
 */
export function normalizeApiPath(rawPath) {
  let pathname = rawPath || '/';
  pathname = pathname.replace(/\/+$/, '') || '/';
  pathname = pathname.replace(FUNCTION_PATH, '') || '/';
  if (pathname === '/' || pathname === '') return API_PREFIX;
  if (pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`)) return pathname;
  // Routed through the function URL: the remainder is the API path.
  return `${API_PREFIX}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

function headersToObject(request) {
  const headers = {};
  for (const [key, value] of request.headers.entries()) {
    headers[key.toLowerCase()] = value;
  }
  return headers;
}

function clientIp(request, context) {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return context?.clientIp || context?.ip || '127.0.0.1';
}

/** API Gateway payload format v2 — the shape `serverless-http` understands. */
export async function requestToEvent(request, { context } = {}) {
  const url = new URL(request.url, 'http://localhost');
  const headers = headersToObject(request);
  // Express's CSRF check compares Origin against Host, so Host must survive even
  // if the platform stripped it from the forwarded request.
  if (!headers.host) headers.host = url.host;

  const method = request.method.toUpperCase();
  // A Buffer, deliberately: the bridge turns a string body through base64 and
  // an object body through JSON.stringify, so handing it an ArrayBuffer here
  // would serialise to `{}` and every JSON endpoint would report the fields as
  // missing. Buffer bodies are passed through untouched.
  const body = method === 'GET' || method === 'HEAD' ? Buffer.alloc(0) : Buffer.from(await request.arrayBuffer());

  const cookie = headers.cookie;
  const cookies = cookie
    ? cookie
        .split(/;\s*/)
        .filter(Boolean)
        .map((entry) => decodeURIComponent(entry.trim()))
    : [];

  return {
    version: '2.0',
    rawPath: normalizeApiPath(url.pathname),
    rawQueryString: url.search.replace(/^\?/, ''),
    headers,
    body,
    isBase64Encoded: false,
    cookies,
    requestContext: {
      requestId: headers['x-nf-request-id'] || randomUUID(),
      accountId: '',
      apiId: 'netlify',
      domainName: url.host,
      stage: config.env,
      time: new Date().toUTCString(),
      timeEpoch: Date.now(),
      http: {
        method,
        path: normalizeApiPath(url.pathname),
        sourceIp: clientIp(request, context),
        protocol: 'HTTP/1.1',
        userAgent: headers['user-agent'] || '',
      },
    },
  };
}

/**
 * Adapter result back into a fetch `Response`.
 *
 * Cookies need explicit care. One `Set-Cookie` arrives as a plain header string,
 * two or more arrive as a list in a separate field, and the bridge deliberately
 * omits `set-cookie` from `headers` in that case. Folding them into one header
 * is not an option either: a comma-joined `Set-Cookie` is unparseable, because
 * `Expires=Sat, 10 Oct 2026...` contains a comma and a space. So every cookie is
 * collected and re-emitted with `append`, which is what makes `Response.headers`
 * return them as separate values.
 */
export function eventResultToResponse(result) {
  const headers = new Headers();
  const cookieLines = [];
  for (const [key, value] of Object.entries(result.headers || {})) {
    if (value === undefined || value === null) continue;
    if (key.toLowerCase() === 'set-cookie') {
      for (const line of Array.isArray(value) ? value : [value]) cookieLines.push(String(line));
      continue;
    }
    headers.append(key, String(value));
  }
  for (const line of result.cookies || []) cookieLines.push(String(line));
  for (const line of result.multiValueHeaders?.['set-cookie'] || []) cookieLines.push(String(line));
  for (const line of new Set(cookieLines)) headers.append('set-cookie', line);

  const status = Number(result.statusCode) || 500;
  const body =
    result.isBase64Encoded && typeof result.body === 'string'
      ? Buffer.from(result.body, 'base64')
      : result.body || null;
  if (status === 204 || status === 205 || status === 304) return new Response(null, { status, headers });
  return new Response(body, { status, headers });
}

let handlerPromise = null;

/**
 * Build (once per warm instance) the handler that serves the API.
 *
 * `binary: true` forces base64 for every body. The adapter's own content-type
 * sniffing only marks a response binary when `BINARY_CONTENT_TYPES` is
 * configured, so without it a receipt PDF or PNG is decoded as UTF-8 text and
 * every non-ASCII byte is replaced — a file that downloads, opens, and is
 * corrupt. The round-trip test in `tests/backend/netlifyHandler.test.ts` is what
 * keeps that honest.
 */
export async function createHandler() {
  assertProductionConfig();
  await ensureMigrated();
  const { default: serverless } = await import('serverless-http');
  const app = createApp();
  // Provider 'aws' understands both payload formats and picks one from
  // event.version; this adapter always emits v2.
  const bridge = serverless(app, { binary: true });
  return async function handle(request, context = {}) {
    const event = await requestToEvent(request, { context });
    const result = await bridge(event, context);
    return eventResultToResponse(result);
  };
}

export function getHandler() {
  if (!handlerPromise) {
    handlerPromise = createHandler().catch((err) => {
      handlerPromise = null;
      throw err;
    });
  }
  return handlerPromise;
}

export async function handleFetch(request, context) {
  const handle = await getHandler();
  return handle(request, context);
}

/** Test seam: drop the memoized handler (used between cases). */
export function resetHandlerCache() {
  handlerPromise = null;
}
