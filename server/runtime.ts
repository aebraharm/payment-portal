// Composition root. Builds the database, storage and mailer from configuration, applies migrations, and
// caches the result so warm serverless instances reuse their connections.

import { loadConfig, type AppConfig } from './config';
import { createPgliteDatabase, createPostgresDatabase, type Database } from './db/database';
import { migrate } from './db/migrate';
import type { Deps } from './deps';
import { createSmtpMailer, type Mailer } from './email/mailer';
import { log } from './lib/logger';
import { createLocalReceiptStorage } from './storage/local';
import { createS3ReceiptStorage } from './storage/s3';
import type { ReceiptStorage } from './storage/types';

export interface RuntimeOptions {
  env?: Record<string, string | undefined>;
  /** Tests use an in-memory embedded database. */
  inMemoryDatabase?: boolean;
  mailer?: Mailer;
  storage?: ReceiptStorage;
  now?: () => Date;
  config?: Partial<AppConfig>;
  /** The migration script applies migrations itself so it can report what changed. */
  skipMigrations?: boolean;
}

export async function createDeps(options: RuntimeOptions = {}): Promise<Deps> {
  const config: AppConfig = { ...loadConfig(options.env ?? process.env), ...options.config };
  const db: Database = config.databaseUrl
    ? await createPostgresDatabase(config.databaseUrl, { ssl: config.databaseSsl, maxConnections: config.serverless ? 2 : 5 })
    : await createPgliteDatabase(options.inMemoryDatabase ? undefined : `${config.dataDir}/pglite`);
  if (!options.skipMigrations) await migrate(db);
  const storage: ReceiptStorage =
    options.storage ??
    (config.receiptStorage === 's3' && config.s3
      ? createS3ReceiptStorage(config.s3)
      : createLocalReceiptStorage(config.receiptStorageDir));
  const mailer = options.mailer ?? createSmtpMailer(config.smtp);
  if (!mailer.configured) {
    log('warn', 'config.email_not_configured', { note: 'Notifications will be recorded as not_configured.' });
  }
  return {
    config,
    db,
    storage,
    mailer,
    now: options.now ?? (() => new Date()),
  };
}

let cached: Promise<Deps> | null = null;

/** Shared runtime for long-lived processes and warm serverless instances. */
export function getRuntime(): Promise<Deps> {
  cached ??= createDeps().catch((error: unknown) => {
    cached = null;
    throw error;
  });
  return cached;
}
