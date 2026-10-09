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
  rootDir,
  databasePath: process.env.DATABASE_PATH || path.join(rootDir, 'server/data/portal.db'),
  uploadDir: process.env.UPLOAD_DIR || path.join(rootDir, 'server/uploads'),
  sessionSecret: process.env.SESSION_SECRET || 'dev-only-insecure-secret-change-me',
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS) || 8,
  adminBootstrap: {
    email: process.env.ADMIN_EMAIL || 'portal11@gmail.com',
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
