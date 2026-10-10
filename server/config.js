import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Which data layer to use.
 *
 * - `sqlite` (default): `node:sqlite` on a local file. This is the VPS /
 *   container / `npm run dev` path and needs no external service.
 * - `libsql`: a hosted libSQL/Turso database over the network. Required on
 *   Netlify, where there is no persistent writable filesystem.
 *
 * Both drivers speak the same SQLite dialect, so `server/migrations/*.sql` and
 * every query in `server/routes` stay identical — only the connection differs.
 */
const dbDriver = (process.env.DB_DRIVER || (process.env.TURSO_DATABASE_URL ? 'libsql' : 'sqlite')).toLowerCase();
if (!['sqlite', 'libsql'].includes(dbDriver)) {
  throw new Error(`[config] Unsupported DB_DRIVER "${dbDriver}". Use "sqlite" or "libsql".`);
}

/**
 * Where uploaded receipts and the branding logo live.
 *
 * - `fs` (default): private directory under UPLOAD_DIR (VPS).
 * - `s3`: any S3-compatible object store with PRIVATE bucket settings
 *   (Netlify). Files are only ever read back through the authenticated
 *   `/api/files/receipts/:id` route — the bucket is never public.
 */
const storageDriver = (process.env.STORAGE_DRIVER || (process.env.S3_BUCKET ? 's3' : 'fs')).toLowerCase();
if (!['fs', 's3'].includes(storageDriver)) {
  throw new Error(`[config] Unsupported STORAGE_DRIVER "${storageDriver}". Use "fs" or "s3".`);
}

// Netlify terminates TLS and forwards the public Host/scheme; the VPS runs
// behind one nginx hop (see DEPLOYMENT.md). A misconfigured proxy count makes
// express-rate-limit key everyone on the proxy's IP, so this is explicit.
const onNetlify = process.env.NETLIFY === 'true' || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

export const config = {
  env: process.env.NODE_ENV || 'development',
  isProduction: (process.env.NODE_ENV || 'development') === 'production',
  isTest: (process.env.NODE_ENV || 'test') === 'test' || !!process.env.VITEST,
  isServerless: onNetlify,
  port: Number(process.env.PORT) || 4000,
  // Bind address. Production defaults to loopback so the API is reachable
  // only through the reverse proxy; set HOST=0.0.0.0 to deliberately expose
  // the app without a proxy (not recommended). Development keeps 0.0.0.0 so
  // the sandbox/dev preview proxy can reach the dev server.
  host:
    process.env.HOST ||
    ((process.env.NODE_ENV || 'development') === 'production' ? '127.0.0.1' : '0.0.0.0'),
  // Number of reverse-proxy hops in front of the app (1 = nginx directly in
  // front, the documented topology). Increase when adding e.g. Cloudflare.
  // Only safe because production binds loopback by default.
  trustProxy: Number(process.env.TRUST_PROXY ?? (onNetlify ? 1 : 1)) || 1,
  rootDir,
  databasePath: process.env.DATABASE_PATH || path.join(rootDir, 'server/data/portal.db'),
  uploadDir: process.env.UPLOAD_DIR || path.join(rootDir, 'server/uploads'),
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS) || 8,
  db: {
    driver: dbDriver,
    // Hosted libSQL (Turso). URL + token come from the environment only — they
    // are never committed and never logged.
    url: process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL || '',
    authToken: process.env.TURSO_DATABASE_TOKEN || process.env.LIBSQL_AUTH_TOKEN || '',
    // Bytes returned per query; a guard rail, not a feature.
    timeoutMs: Number(process.env.DB_TIMEOUT_MS) || 15000,
  },
  storage: {
    driver: storageDriver,
    bucket: process.env.S3_BUCKET || '',
    region: process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT || '',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    accessKeyId: process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '',
    // Prefix inside the bucket, so one bucket can hold several environments.
    prefix: (process.env.S3_PREFIX || 'payment-portal').replace(/^\/+|\/+$/g, ''),
    // Only needed when the bucket should request an SSE header explicitly.
    serverSideEncryption: process.env.S3_SERVER_SIDE_ENCRYPTION === 'true',
  },
  adminBootstrap: {
    // No built-in default for the email on purpose: the bootstrap administrator
    // is only ever created from ADMIN_EMAIL / ADMIN_PASSWORD provided via the
    // environment — never from a value committed to source control.
    email: process.env.ADMIN_EMAIL || '',
    password: process.env.ADMIN_PASSWORD || '',
  },
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASSWORD || '',
    from: process.env.SMTP_FROM || 'Payment Portal <no-reply@example.com>',
  },
  notifyAdminEmail: process.env.NOTIFY_ADMIN_EMAIL || '',
  rateLimit: {
    authMax: Number(process.env.RATE_LIMIT_AUTH_MAX) || 10,
    authWindowMs: Number(process.env.RATE_LIMIT_AUTH_WINDOW_MS) || 15 * 60 * 1000,
    generalMax: Number(process.env.RATE_LIMIT_GENERAL_MAX) || 600,
    generalWindowMs: Number(process.env.RATE_LIMIT_GENERAL_WINDOW_MS) || 60 * 1000,
    /**
     * `memory` keeps counters in this process; `db` shares them through the
     * database. A serverless deployment runs many isolated instances, so an
     * in-memory counter never sees the other instances' hits and silently stops
     * limiting — hence `db` whenever the data lives off-box.
     */
    store: (process.env.RATE_LIMIT_STORE || (dbDriver === 'libsql' || onNetlify ? 'db' : 'memory')).toLowerCase(),
  },
  brandDefaults: {
    primaryColor: process.env.BRAND_PRIMARY_COLOR || '#2563eb',
    secondaryColor: process.env.BRAND_SECONDARY_COLOR || '#0b2447',
  },
};

/**
 * Fail fast, before serving a single request, when a serverless-shaped
 * configuration is missing the pieces that make it safe. Called by the
 * entrypoints, not at import time, so `npm run build` and unit tests are
 * unaffected.
 */
export function assertProductionConfig() {
  const problems = [];
  if (config.db.driver === 'libsql' && !config.db.url) problems.push('DB_DRIVER=libsql requires TURSO_DATABASE_URL');
  if (config.db.driver === 'libsql' && !config.db.authToken) problems.push('DB_DRIVER=libsql requires TURSO_DATABASE_TOKEN');
  if (config.storage.driver === 's3') {
    if (!config.storage.bucket) problems.push('STORAGE_DRIVER=s3 requires S3_BUCKET');
    if (!config.storage.accessKeyId || !config.storage.secretAccessKey) {
      problems.push('STORAGE_DRIVER=s3 requires S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY');
    }
  }
  if (config.storage.driver === 'fs' && config.isServerless) {
    problems.push('Serverless hosts have no persistent disk: set STORAGE_DRIVER=s3 with a private bucket');
  }
  if (config.db.driver === 'sqlite' && config.isServerless) {
    problems.push('Serverless hosts have no persistent disk: set DB_DRIVER=libsql with a hosted database');
  }
  if (config.rateLimit.store === 'memory' && config.isServerless) {
    problems.push('Serverless needs a shared rate-limit store: set RATE_LIMIT_STORE=db');
  }
  if (problems.length) {
    throw new Error(`[config] Invalid serverless configuration:\n  - ${problems.join('\n  - ')}`);
  }
}

export function smtpConfigured() {
  return Boolean(config.smtp.host && config.smtp.user);
}
