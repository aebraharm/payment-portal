// Shim so Vite/vitest (vite 5 does not list node:sqlite as a builtin) can load
// the Node.js built-in SQLite module. The real module is loaded through
// createRequire, bypassing Vite's module resolution entirely.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const mod = require('node:sqlite') as typeof import('node:sqlite');

export const DatabaseSync = mod.DatabaseSync;
export const StatementSync = mod.StatementSync;
export const SupportedValueType = mod.SupportedValueType;
