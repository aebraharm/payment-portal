import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  env: process.env.NODE_ENV || 'development',
  isProduction: (process.env.NODE_ENV || 'development') === 'production',
  isTest: (process.env.NODE_ENV || 'test') === 'test' || !!process.env.VITEST,
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
  trustProxy: Number(process.env.TRUST_PROXY ?? 1) || 1,
  rootDir,
  databasePath: process.env.DATABASE_PATH || path.join(rootDir, 'server/data/portal.db'),
  uploadDir: process.env.UPLOAD_DIR || path.join(rootDir, 'server/uploads'),
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS) || 8,
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
  },
  brandDefaults: {
    primaryColor: process.env.BRAND_PRIMARY_COLOR || '#2563eb',
    secondaryColor: process.env.BRAND_SECONDARY_COLOR || '#0b2447',
  },
};

export function smtpConfigured() {
  return Boolean(config.smtp.host && config.smtp.user);
}
