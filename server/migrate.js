import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execScript, run, all, isoNow } from './db.js';


const moduleDir = path.dirname(fileURLToPath(import.meta.url));

const migrationCandidates = [
  path.resolve(moduleDir, 'migrations'),
  path.resolve(process.cwd(), 'server', 'migrations'),
  path.resolve(moduleDir, '..', '..', 'server', 'migrations'),
];

const migrationsDir = migrationCandidates.find((dir) => fs.existsSync(dir));

if (!migrationsDir) {
  throw new Error(
    `Migrations directory not found. Checked: ${migrationCandidates.join(', ')}`
  );
}

export function pendingMigrations(applied) {
  return fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((file) => !applied.has(file));
}

/**
 * Apply every unapplied `.sql` file in `server/migrations`, in filename order.
 *
 * Each file is applied and recorded in the same step, and a file that fails is
 * never recorded, so a partially applied deploy stops loudly instead of quietly
 * skipping a migration. `schema_migrations` is created first because that is
 * the table the ledger needs.
 */
export async function migrate() {
  await execScript(
    'CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL);'
  );
  const rows = await all('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.name));
  let count = 0;
  for (const file of pendingMigrations(applied)) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await execScript(sql);
    await run('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', [file, isoNow()]);
    count += 1;
  }
  return count;
}

let migrationPromise = null;

/**
 * Migrate at most once per process.
 *
 * On a VPS `server/index.js` migrates at boot. On Netlify there is no boot: an
 * instance can start at any time, so migrations run on the first request an
 * instance sees and are memoized for the rest of that instance's life. Running
 * the DDL on every invocation would add latency to every request and race with
 * other cold instances.
 */
export function ensureMigrated() {
  if (!migrationPromise) {
    migrationPromise = migrate().catch((err) => {
      migrationPromise = null;
      throw err;
    });
  }
  return migrationPromise;
}

/** Test seam: forget that this process has migrated. */
export function resetMigrationState() {
  migrationPromise = null;
}

/** Names of the migrations that have been applied, oldest first. */
export async function appliedMigrations() {
  const rows = await all('SELECT name FROM schema_migrations ORDER BY id');
  return rows.map((r) => r.name);
}

// Allow running directly: `npm run migrate`
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await migrate();
  console.log('[migrate] database is up to date');
}
