// Applies pending database migrations. Safe to run repeatedly.
// Usage: npm run db:migrate   (reads DATABASE_URL; without it, uses the local development database)

import { createDeps } from '../runtime';
import { migrate } from '../db/migrate';

const deps = await createDeps({ skipMigrations: true });
const report = await migrate(deps.db);
console.log(JSON.stringify({ database: deps.db.kind, applied: report.applied, alreadyApplied: report.skipped.length }));
await deps.db.close();
