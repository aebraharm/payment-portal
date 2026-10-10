import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createSpaMiddleware } from '../../server/lib/spa.js';
import { notFoundHandler, errorHandler } from '../../server/middleware/error.js';

/**
 * The VPS deployment path has to answer deep links the same way Netlify's
 * `/*` -> `/index.html` rule does, because the router lives in the browser and
 * the server only ever sees `index.html`. These tests pin that behaviour for
 * the middleware `server/app.js` mounts in production.
 */
const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-dist-'));
fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><title>Portal</title><div id="root"></div>\n');
fs.mkdirSync(path.join(distDir, 'assets'), { recursive: true });
fs.writeFileSync(path.join(distDir, 'assets', 'app.js'), 'console.log("app");\n');

afterAll(() => fs.rmSync(distDir, { recursive: true, force: true }));

function makeApp({ dist = distDir } = {}) {
  const app = express();
  // Same order as createApp(): API first, SPA last.
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.use(createSpaMiddleware({ distDir: dist }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('production SPA fallback', () => {
  it('returns index.html for a client-side deep link', async () => {
    const res = await request(makeApp()).get('/admin/login');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('id="root"');
  });

  it('returns index.html again on refresh (repeat GET, no server state)', async () => {
    const app = makeApp();
    const first = await request(app).get('/admin/login');
    const second = await request(app).get('/admin/login');
    expect(second.status).toBe(first.status);
    expect(second.text).toBe(first.text);
  });

  it('covers nested and parameterised client routes', async () => {
    const app = makeApp();
    for (const url of ['/login', '/admin', '/admin/clients/12', '/pay/7/submit', '/legal/terms']) {
      const res = await request(app).get(url);
      expect(res.status, url).toBe(200);
      expect(res.text, url).toContain('id="root"');
    }
  });

  it('serves built asset files instead of index.html', async () => {
    const res = await request(makeApp()).get('/assets/app.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('console.log("app")');
    expect(res.text).not.toContain('id="root"');
  });

  it('never shadows an API route', async () => {
    const res = await request(makeApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('lets a missing API endpoint stay a JSON 404 rather than HTML', async () => {
    const res = await request(makeApp()).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.error.code).toBe('not_found');
  });

  it('does not fall back to index.html when no build exists', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-nodist-'));
    try {
      const res = await request(makeApp({ dist: empty })).get('/admin/login');
      expect(res.status).toBe(404);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});
