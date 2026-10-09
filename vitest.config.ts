import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // Vite 5 does not recognise node:sqlite as a builtin; load it through a
      // createRequire-based shim instead.
      { find: /^node:sqlite$/, replacement: path.resolve(__dirname, 'tests/shims/sqlite.ts') },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    environmentMatchGlobs: [['tests/frontend/**', 'jsdom']],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 30000,
    pool: 'forks',
  },
});
