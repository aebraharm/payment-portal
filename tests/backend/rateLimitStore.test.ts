import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { config } from '../../server/config.js';
import { all, execScript, closeDb } from '../../server/db.js';
import { createApp } from '../../server/app.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './helpers.js';
import { createDbRateLimitStore, createRateLimitStore } from '../../server/lib/rateLimitStore.js';
import { seedDatabase } from '../../server/seed.js';

/**
 * Rate limiting is the defence that is silently lost in a serverless deployment:
 * `express-rate-limit`'s default store keeps counts in module scope, so every
 * warm function instance has its own empty counter and the limit is theatre.
 * These tests exercise the shared store the way a serverless host does — by
 * building two separate `createApp()` instances (two invocations, one database)
 * and by simulating a cold start — and then prove the converse for the memory
 * store, so the reason `RATE_LIMIT_STORE=db` exists stays written down.
 */
const WINDOW_TABLE = 'rate_limit_buckets';
const BAD_PASSWORD = 'definitely-not-the-password';

function attemptLogin(app, password = BAD_PASSWORD) {
  return request(app).post('/api/admin/auth/login').send({ email: ADMIN_EMAIL, password });
}

async function clearWindows() {
  await execScript(`DELETE FROM ${WINDOW_TABLE};`);
}

/** Total hits across every window row for that limiter (there should be one). */
async function hitCount(label = 'auth') {
  const rows = await all(`SELECT hits FROM ${WINDOW_TABLE} WHERE bucket_key LIKE ?`, [`rl:${label}|%`]);
  return { rows: rows.length, total: rows.reduce((sum, row) => sum + Number(row.hits), 0) };
}

let originalStore;
let originalAuthMax;

beforeAll(async () => {
  await seedDatabase();
  originalStore = config.rateLimit.store;
  originalAuthMax = config.rateLimit.authMax;
  config.rateLimit.authMax = 10;
  await clearWindows();
});

afterAll(async () => {
  config.rateLimit.store = originalStore;
  config.rateLimit.authMax = originalAuthMax;
  await clearWindows();
  await closeDb();
});

describe('database-backed rate limiting', () => {
  it('shares the block across separate app instances', async () => {
    config.rateLimit.store = 'db';
    // Two apps, because each builds its own limiter — this is the whole point.
    const appA = createApp();
    const appB = createApp();
    await clearWindows();

    for (let i = 0; i < 10; i += 1) {
      const res = await attemptLogin(i % 2 === 0 ? appA : appB);
      expect(res.status).toBe(401);
    }

    // The 11th is refused no matter which instance receives it: the count came
    // from the shared table, not from that process's memory.
    expect((await attemptLogin(appA)).status).toBe(429);
    expect((await attemptLogin(appB)).status).toBe(429);

    const limited = await attemptLogin(appA);
    expect(limited.body.error.code).toBe('rate_limited');
    expect(limited.headers['retry-after']).toBeTruthy();

    const stored = await hitCount('auth');
    // One row for the shared window, holding every attempt from both instances.
    expect(stored.rows).toBe(1);
    expect(stored.total).toBeGreaterThanOrEqual(11);
  }, 60000);

  it('counts a correct password against the same window', async () => {
    // Blocking a real sign-in during a burst is the intended trade; the
    // important part is that a successful attempt cannot bypass the limit.
    config.rateLimit.store = 'db';
    const app = createApp();
    await clearWindows();
    for (let i = 0; i < 10; i += 1) expect((await attemptLogin(app)).status).toBe(401);
    const blocked = await attemptLogin(app, ADMIN_PASSWORD);
    expect(blocked.status).toBe(429);
    expect(blocked.headers['set-cookie']).toBeUndefined();

    // Once the window is cleared the same credentials work, and the limiter path
    // has not swallowed the session cookie on the way through.
    await clearWindows();
    const ok = await attemptLogin(app, ADMIN_PASSWORD);
    expect(ok.status).toBe(200);
    const cookie = (ok.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
    expect(cookie).toMatch(/^admin_session=/);
    const me = await request(app).get('/api/admin/auth/me').set('cookie', cookie);
    expect(me.status).toBe(200);
  }, 60000);

  it('shows a live request how much of its window is left', async () => {
    config.rateLimit.store = 'db';
    const app = createApp();
    await clearWindows();
    const res = await attemptLogin(app);
    expect(res.status).toBe(401);
    // standardHeaders 'draft-7' puts all three values in one header, and a
    // client that cannot see `remaining` has no way to back off before locking
    // itself out of its own account.
    const header = String(res.headers['ratelimit']);
    expect(header).toMatch(/limit=10/);
    expect(header).toMatch(/remaining=9/);
    expect(Number(header.match(/reset=(\d+)/)?.[1])).toBeGreaterThan(0);
    expect(String(res.headers['ratelimit-policy'])).toMatch(/10;w=\d+/);
  }, 60000);

  it('proves why an in-memory store is not enough: it does not share state', async () => {
    // Compared at the store level on purpose. `server/routes/auth.js` builds its
    // limiter once at module scope, so inside a single process two `createApp()`
    // calls share even the in-memory counters — while on Netlify each invocation
    // is a fresh process, which is exactly when that stops being true. Ten
    // attackers on ten cold instances each get their own full budget of 10.
    config.rateLimit.store = 'memory';
    const one = createRateLimitStore({ label: 'isolation' });
    const two = createRateLimitStore({ label: 'isolation' });
    one.init({ windowMs: 900_000, limit: 10 });
    two.init({ windowMs: 900_000, limit: 10 });
    for (let i = 0; i < 5; i += 1) await one.increment('127.0.0.1');
    for (let i = 0; i < 5; i += 1) await two.increment('127.0.0.1');
    expect((await one.increment('127.0.0.1')).totalHits).toBe(6);
    expect((await two.increment('127.0.0.1')).totalHits).toBe(6);
    // Nothing reached the database, so no other instance could ever see this.
    expect((await hitCount('isolation')).total).toBe(0);

    // The same six attempts through the shared store: one window, one count.
    config.rateLimit.store = 'db';
    const three = createRateLimitStore({ label: 'isolation' });
    const four = createRateLimitStore({ label: 'isolation' });
    three.init({ windowMs: 900_000, limit: 10 });
    four.init({ windowMs: 900_000, limit: 10 });
    for (let i = 0; i < 5; i += 1) await three.increment('127.0.0.1');
    for (let i = 0; i < 5; i += 1) await four.increment('127.0.0.1');
    expect((await three.increment('127.0.0.1')).totalHits).toBe(11);
    expect((await four.increment('127.0.0.1')).totalHits).toBe(12);
    expect((await hitCount('isolation')).total).toBe(12);
    await clearWindows();
  }, 60000);

  it('blocks a cold start once the shared window is already full', async () => {
    // The serverless case exactly: an invocation that has never seen a request
    // must still honour a window its predecessors filled.
    config.rateLimit.store = 'db';
    const warm = createApp();
    await clearWindows();
    for (let i = 0; i < 10; i += 1) expect((await attemptLogin(warm)).status).toBe(401);

    const coldStart = createApp();
    expect((await attemptLogin(coldStart)).status).toBe(429);
  }, 60000);

  it('names counters by limiter so a busy API cannot exhaust sign-in attempts', async () => {
    // The general limiter is skipped in NODE_ENV=test, so the namespaces are
    // checked against the store directly rather than through HTTP.
    await clearWindows();
    const auth = createDbRateLimitStore({ label: 'auth', prune: false });
    const general = createDbRateLimitStore({ label: 'general', prune: false });
    auth.init({ windowMs: 900_000, limit: 10 });
    // Both use the same long window so the assertion below cannot straddle a
    // window boundary and count two half-windows.
    general.init({ windowMs: 900_000, limit: 600 });

    for (let i = 0; i < 3; i += 1) await auth.increment('127.0.0.1');
    for (let i = 0; i < 7; i += 1) await general.increment('127.0.0.1');

    // Same key, same IP, same table — and still independent windows.
    expect((await auth.increment('127.0.0.1')).totalHits).toBe(4);
    expect((await general.increment('127.0.0.1')).totalHits).toBe(8);
    expect((await hitCount('auth')).total).toBe(4);
    expect((await hitCount('general')).total).toBe(8);

    // resetTime must agree with the limiter's own window, or the Retry-After the
    // client is handed would be a guess.
    const { resetTime } = await auth.increment('127.0.0.1');
    expect(resetTime.getTime() - Date.now()).toBeLessThanOrEqual(900_000);
    expect(resetTime.getTime()).toBeGreaterThan(Date.now());

    // A failed payment attempt releases the slot; the row must follow.
    await general.decrement('127.0.0.1');
    expect((await hitCount('general')).total).toBe(7);
    await clearWindows();
  }, 60000);
});
