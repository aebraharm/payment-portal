import { get, run, isoNow } from '../db.js';
import { config } from '../config.js';
import { MemoryStore } from 'express-rate-limit';

/**
 * A rate-limit counter that lives in the database instead of in this process.
 *
 * express-rate-limit's default MemoryStore keeps counts in module scope. That is
 * fine on a VPS (one process, forever) and useless on Netlify: every warm
 * instance has its own empty counter, so an attacker who trips 10 cold
 * instances has made 10 uncoordinated requests against a limit of 10 and the
 * limiter reports nothing. Sharing the window through the database is what makes
 * the limit real on a serverless host.
 *
 * Implements the express-rate-limit v7 Store interface: `init`, `increment`,
 * `decrement`, `resetKey`. Counters for different limiters are namespaced by
 * `label`, so a busy API cannot eat the sign-in attempt budget.
 */
export function createDbRateLimitStore({ label = 'default', prune = true } = {}) {
  let windowMs = 60_000;
  const name = `rl:${label}`;

  const windowStart = () => Math.floor(Date.now() / windowMs) * windowMs;

  return {
    // Shared across limiter instances, so the check that warns about that must
    // be told this store is meant to be shared.
    localKeys: false,

    init(options) {
      // The window comes from the limiter's own config so the table's rows and
      // the middleware's headers always agree.
      windowMs = Number(options?.windowMs) || windowMs;
    },

    /**
     * One atomic upsert that hands back the new count. Done as a single
     * statement (rather than read-then-write) because two function invocations
     * can land on the same window at the same instant, and because on a hosted
     * database every extra round trip is paid by the person signing in.
     */
    async increment(key) {
      const startedAt = windowStart();
      const row = await get(
        `INSERT INTO rate_limit_buckets (bucket_key, window_start, hits, updated_at)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(bucket_key, window_start) DO UPDATE
           SET hits = rate_limit_buckets.hits + 1, updated_at = excluded.updated_at
         RETURNING hits`,
        [`${name}|${key}`, startedAt, isoNow()]
      );
      // express-rate-limit v7 reads `totalHits` specifically; returning a
      // differently-named field makes it see `undefined`, which fails its
      // validation and — worse — compares false against the limit, so the
      // limiter counts, reports, and blocks nothing.
      const totalHits = Number(row?.hits ?? 1);
      if (prune && totalHits === 1) {
        // Only on the first hit of a window: cheap, and it keeps the table from
        // growing one row per client per minute forever.
        await run('DELETE FROM rate_limit_buckets WHERE bucket_key = ? AND window_start < ?', [
          `${name}|${key}`,
          startedAt - windowMs,
        ]);
      }
      return { totalHits, resetTime: new Date(startedAt + windowMs) };
    },

    async decrement(key) {
      await run('UPDATE rate_limit_buckets SET hits = hits - 1 WHERE bucket_key = ? AND window_start = ? AND hits > 0', [
        `${name}|${key}`,
        windowStart(),
      ]);
    },

    async resetKey(key) {
      await run('DELETE FROM rate_limit_buckets WHERE bucket_key = ? AND window_start = ?', [
        `${name}|${key}`,
        windowStart(),
      ]);
    },
  };
}

/**
 * The store `express-rate-limit` is actually handed.
 *
 * It decides *per request* which backend to use instead of once, at limiter
 * construction. That distinction matters here: `server/routes/auth.js` builds
 * its limiter while the module is still being imported, i.e. before anything
 * could adjust `config`, so a store chosen there would silently ignore
 * `RATE_LIMIT_STORE` and depend on import order. Choosing lazily keeps the
 * setting honest in tests and on a long-lived server.
 *
 * The in-memory branch is this module's own `MemoryStore` instance (the same
 * default `express-rate-limit` uses internally) — it is not shared between two
 * `createApp()` calls, which is exactly the behaviour that makes it wrong for a
 * serverless host.
 */
export function createRateLimitStore({ label = 'default' } = {}) {
  const memory = new MemoryStore();
  let db = null;
  let storedOptions = null;
  const active = () => {
    if (config.rateLimit.store !== 'db') return memory;
    if (!db) {
      db = createDbRateLimitStore({ label });
      // The db store needs the limiter's window to agree with the middleware's
      // own, or `Retry-After` and the row's window boundary disagree.
      if (storedOptions) db.init(storedOptions);
    }
    return db;
  };
  return {
    localKeys: false,
    init(options) {
      storedOptions = options;
      memory.init(options);
      if (db) db.init(options);
    },
    async increment(key) {
      return active().increment(key);
    },
    async decrement(key) {
      return active().decrement(key);
    },
    async resetKey(key) {
      return active().resetKey(key);
    },
  };
}
