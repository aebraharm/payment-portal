// Runs invoice reminders once. Used by the local scheduler and by operators; production schedules the
// Netlify function netlify/functions/reminders.mts instead.
// Usage: npm run jobs:reminders

import { createDeps } from '../runtime';
import { sweepReminders } from '../services/notifications';

const deps = await createDeps();
try {
  console.log(JSON.stringify(await sweepReminders(deps)));
} finally {
  await deps.db.close();
}
