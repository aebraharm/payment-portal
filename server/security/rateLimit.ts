// Fixed-window rate limiting stored in the database, so limits hold across serverless instances.
// The upsert is atomic: concurrent attempts cannot slip past the limit.

import type { Queryable } from '../db/database';

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export async function hitRateLimit(
  db: Queryable,
  key: string,
  max: number,
  windowMs: number,
  now: Date,
): Promise<RateLimitDecision> {
  const windowStart = Math.floor(now.getTime() / windowMs) * windowMs;
  const { rows } = await db.query<{ hits: number }>(
    `INSERT INTO rate_limits (key, window_started_at, hits)
     VALUES ($1, to_timestamp($2::double precision / 1000), 1)
     ON CONFLICT (key) DO UPDATE SET
       hits = CASE WHEN rate_limits.window_started_at = EXCLUDED.window_started_at
                   THEN rate_limits.hits + 1 ELSE 1 END,
       window_started_at = EXCLUDED.window_started_at
     RETURNING hits`,
    [key, windowStart],
  );
  return {
    allowed: rows[0].hits <= max,
    retryAfterSeconds: Math.max(1, Math.ceil((windowStart + windowMs - now.getTime()) / 1000)),
  };
}

export async function clearRateLimit(db: Queryable, key: string): Promise<void> {
  await db.query('DELETE FROM rate_limits WHERE key = $1', [key]);
}
