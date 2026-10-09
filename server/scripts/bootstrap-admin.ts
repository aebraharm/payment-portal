// One-time command that creates the first administrator from ADMIN_BOOTSTRAP_EMAIL and
// ADMIN_BOOTSTRAP_PASSWORD. The password is never printed. Safe to run again.
// Usage: npm run db:bootstrap-admin

import { createDeps } from '../runtime';
import { bootstrapAdmin } from '../services/bootstrap';

const deps = await createDeps();
try {
  const result = await bootstrapAdmin(deps);
  const messages: Record<typeof result, string> = {
    created: 'Administrator account created. The account must change its password at first sign-in.',
    exists: 'An administrator with this email already exists. Nothing was changed.',
    skipped: 'ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD are not set. Nothing was done.',
  };
  console.log(messages[result]);
  if (result === 'created') {
    console.log('Remove ADMIN_BOOTSTRAP_PASSWORD from the environment now that the account exists.');
  }
  process.exitCode = result === 'skipped' ? 1 : 0;
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Bootstrap failed.');
  process.exitCode = 1;
} finally {
  await deps.db.close();
}
