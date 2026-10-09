import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, run, isoNow } from './db.js';

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export function migrate() {
  const db = getDb();
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL);'
  );
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const applied = new Set(
    db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name)
  );
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    db.exec(sql);
    run('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', [file, isoNow()]);
    console.log(`[migrate] applied ${file}`);
  }
}

// Allow running directly: `node server/migrate.js`
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  migrate();
  console.log('[migrate] database is up to date');
}
