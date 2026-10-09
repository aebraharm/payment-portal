// Netlify scheduled function: sends invoice due-soon and overdue reminders once a day. Each reminder has
// a dedupe key, so reruns never send the same message twice.

import { getRuntime } from '../../server/runtime';
import { sweepReminders } from '../../server/services/notifications';

export default async (): Promise<Response> => {
  const deps = await getRuntime();
  const result = await sweepReminders(deps);
  return Response.json(result);
};

export const config = {
  schedule: '@daily',
};
