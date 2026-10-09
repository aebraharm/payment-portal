// Internal endpoints for scheduled jobs. Protected by a shared secret, compared in constant time.
// Without CRON_SECRET the endpoint refuses every request, so it is never open by default.

import { Hono } from 'hono';
import type { Deps } from '../../deps';
import { AppError, unauthorized } from '../../lib/errors';
import { log } from '../../lib/logger';
import { safeEqual } from '../../lib/crypto';
import { sweepReminders } from '../../services/notifications';
import type { AppEnv } from '../context';

export function internalRoutes(deps: Deps) {
  const router = new Hono<AppEnv>();

  router.post('/reminders', async (c) => {
    const secret = deps.config.cronSecret;
    if (!secret) {
      throw new AppError(503, 'NOT_CONFIGURED', 'Scheduled reminders are not configured. Set CRON_SECRET to enable them.');
    }
    const header = c.req.header('authorization') ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!provided || !safeEqual(provided, secret)) throw unauthorized('Not authorised.');
    const result = await sweepReminders(deps);
    log('info', 'reminders.run', { dueSoon: result.dueSoon, overdue: result.overdue, skipped: result.skipped });
    return c.json(result);
  });

  return router;
}
