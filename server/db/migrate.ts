// Forward-only SQL migrations. Each migration runs in its own transaction, guarded by an advisory
// lock so concurrent deploy steps cannot apply the same migration twice.

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Database } from './database';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));
const MIGRATION_LOCK_ID = 727274;

export interface MigrationReport {
  applied: string[];
  skipped: string[];
}

export async function listMigrations(): Promise<{ id: string; sql: string }[]> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith('.sql')).sort();
  return Promise.all(
    files.map(async (name) => ({
      id: name.replace(/\.sql$/, ''),
      sql: await readFile(`${MIGRATIONS_DIR}${name}`, 'utf8'),
    })),
  );
}

export async function migrate(db: Database): Promise<MigrationReport> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const report: MigrationReport = { applied: [], skipped: [] };
  for (const migration of await listMigrations()) {
    await db.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_ID]);
      const existing = await tx.query('SELECT 1 FROM schema_migrations WHERE id = $1', [migration.id]);
      if (existing.rowCount > 0) {
        report.skipped.push(migration.id);
        return;
      }
      await tx.exec(migration.sql);
      await tx.query('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id]);
      report.applied.push(migration.id);
    });
  }
  return report;
}
