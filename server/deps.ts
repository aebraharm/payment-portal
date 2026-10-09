import type { AppConfig } from './config';
import type { Database } from './db/database';
import type { Mailer } from './email/mailer';
import type { ReceiptStorage } from './storage/types';
import { todayIn } from '../shared/dates';

export interface Deps {
  config: AppConfig;
  db: Database;
  storage: ReceiptStorage;
  mailer: Mailer;
  now: () => Date;
}

export function todayFor(deps: Deps): string {
  return todayIn(deps.config.timeZone, deps.now());
}
