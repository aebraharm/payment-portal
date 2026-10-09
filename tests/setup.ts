import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Test environment — configured BEFORE any server module is imported, because
// server/config.js reads process.env at module load time.
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = ':memory:';
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-uploads-'));
process.env.UPLOAD_DIR = uploadDir;
process.env.ADMIN_EMAIL = 'test-bootstrap-admin@example.com';
process.env.ADMIN_PASSWORD = 'TestBootstrapPass123';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.RATE_LIMIT_AUTH_MAX = '100000';
process.env.RATE_LIMIT_GENERAL_MAX = '100000';

// Silence the experimental node:sqlite warning in test output.
const originalEmitWarning = process.emitWarning;
process.emitWarning = (warning: unknown, ...args: unknown[]) => {
  if (typeof warning === 'string' && warning.includes('SQLite')) return;
  return originalEmitWarning.call(process, warning as never, ...(args as never[]));
};
