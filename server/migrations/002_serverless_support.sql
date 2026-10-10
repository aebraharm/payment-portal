-- ============================================================================
-- Serverless support: shared rate-limit counters.
--
-- On a VPS, express-rate-limit can keep its counters in process memory. On a
-- serverless host there is no long-lived process to keep them in, so the
-- counters move into the database and every function instance shares the same
-- window. The table is also used when DB_DRIVER=sqlite and RATE_LIMIT_STORE=db,
-- which is how the behaviour is exercised in tests.
--
-- window_start is the epoch millisecond of the start of the fixed window, so a
-- row is addressable by (bucket, window) and old windows are trivial to prune.
-- ============================================================================

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (bucket_key, window_start)
);

-- Lets an operator clear one limiter's counters without a full-table scan, and
-- keeps the periodic prune of stale windows cheap.
CREATE INDEX IF NOT EXISTS idx_rate_limit_prefix ON rate_limit_buckets(bucket_key, window_start);

-- Sessions are looked up by hash on every request and expired rows are swept by
-- the admin security screen; make both use an index instead of a scan.
CREATE INDEX IF NOT EXISTS idx_sessions_active_lookup ON sessions(token_hash, revoked_at, expires_at);
