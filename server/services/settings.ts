// Agency settings with draft and publish. Admins edit drafts and preview them. Public pages and
// client workflows read published values only, so an unfinished edit never reaches clients.

import {
  DEFAULT_SETTINGS,
  SETTINGS_KEYS,
  SETTINGS_SCHEMAS,
  type SettingsKey,
  type SettingsValues,
} from '../../shared/settings';
import type { Queryable } from '../db/database';
import { notFound, unprocessable } from '../lib/errors';
import { fieldErrors } from '../lib/validate';
import { recordAudit, type Actor } from './audit';
import { UUID_RE } from './common';

export interface SettingsRow<K extends SettingsKey = SettingsKey> {
  key: K;
  draft: SettingsValues[K];
  published: SettingsValues[K];
  draftUpdatedAt: string | null;
  publishedAt: string | null;
  hasUnpublishedChanges: boolean;
}

export async function ensureSettingsRows(db: Queryable): Promise<void> {
  const values: unknown[] = [];
  const tuples: string[] = [];
  SETTINGS_KEYS.forEach((key, index) => {
    const json = JSON.stringify(DEFAULT_SETTINGS[key]);
    values.push(key, json, json);
    tuples.push(`($${index * 3 + 1}, $${index * 3 + 2}::jsonb, $${index * 3 + 3}::jsonb)`);
  });
  await db.query(
    `INSERT INTO settings (key, draft_value, published_value) VALUES ${tuples.join(', ')}
     ON CONFLICT (key) DO NOTHING`,
    values,
  );
}

function withDefaults<K extends SettingsKey>(key: K, stored: unknown): SettingsValues[K] {
  return { ...DEFAULT_SETTINGS[key], ...((stored as object | null) ?? {}) } as SettingsValues[K];
}

export type SettingsRows = { [K in SettingsKey]: SettingsRow<K> };

export async function readSettingsRows(db: Queryable): Promise<SettingsRows> {
  await ensureSettingsRows(db);
  const { rows } = await db.query<{
    key: SettingsKey;
    draft_value: unknown;
    published_value: unknown;
    updated_at: Date | null;
    published_at: Date | null;
  }>('SELECT key, draft_value, published_value, updated_at, published_at FROM settings');
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const out = {} as Record<string, SettingsRow>;
  for (const key of SETTINGS_KEYS) {
    const row = byKey.get(key);
    const draft = withDefaults(key, row?.draft_value);
    const published = withDefaults(key, row?.published_value);
    out[key] = {
      key,
      draft,
      published,
      draftUpdatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
      publishedAt: row?.published_at ? new Date(row.published_at).toISOString() : null,
      hasUnpublishedChanges: JSON.stringify(draft) !== JSON.stringify(published),
    } as SettingsRow;
  }
  return out as SettingsRows;
}

export async function readPublished(db: Queryable): Promise<SettingsValues> {
  await ensureSettingsRows(db);
  const { rows } = await db.query<{ key: SettingsKey; published_value: unknown }>(
    'SELECT key, published_value FROM settings',
  );
  const byKey = new Map(rows.map((row) => [row.key, row.published_value]));
  const out = {} as Record<string, unknown>;
  for (const key of SETTINGS_KEYS) out[key] = withDefaults(key, byKey.get(key));
  return out as unknown as SettingsValues;
}

export async function readPublishedGroup<K extends SettingsKey>(db: Queryable, key: K): Promise<SettingsValues[K]> {
  const all = await readPublished(db);
  return all[key];
}

function changedTopLevelKeys(before: unknown, after: unknown): string[] {
  const a = (before ?? {}) as Record<string, unknown>;
  const b = (after ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]));
}

async function assertAssetsExist(db: Queryable, values: SettingsValues['branding']): Promise<void> {
  const checks: [string | null, string][] = [
    [values.logoAssetId, 'logo'],
    [values.faviconAssetId, 'favicon'],
  ];
  for (const [id, kind] of checks) {
    if (!id) continue;
    if (!UUID_RE.test(id)) throw unprocessable('Invalid asset reference.', { [`${kind}AssetId`]: 'Upload the file again.' });
    const { rowCount } = await db.query('SELECT 1 FROM branding_assets WHERE id = $1 AND kind = $2', [id, kind]);
    if (rowCount === 0) {
      throw unprocessable(`The ${kind} file could not be found. Upload it again.`, { [`${kind}AssetId`]: 'Missing file.' });
    }
  }
}

export async function saveDraft(
  db: Queryable,
  key: SettingsKey,
  input: unknown,
  actor: Actor,
  now: Date,
): Promise<SettingsValues[SettingsKey]> {
  const schema = SETTINGS_SCHEMAS[key];
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw unprocessable('Please correct the highlighted settings.', fieldErrors(parsed.error));
  }
  const value = parsed.data as SettingsValues[SettingsKey];
  if (key === 'branding') await assertAssetsExist(db, value as SettingsValues['branding']);

  await ensureSettingsRows(db);
  const before = await db.query<{ draft_value: unknown }>('SELECT draft_value FROM settings WHERE key = $1', [key]);
  await db.query(
    'UPDATE settings SET draft_value = $2::jsonb, updated_at = $3, updated_by = $4 WHERE key = $1',
    [key, JSON.stringify(value), now, actor.id],
  );
  const changed = changedTopLevelKeys(before.rows[0]?.draft_value, value);
  await recordAudit(
    db,
    actor,
    {
      action: 'settings.draft_saved',
      summary: `Draft saved for ${key} settings`,
      entityType: 'settings',
      entityId: key,
      metadata: { changedFields: changed },
    },
    now,
  );
  return value;
}

export async function publishSettings(db: Queryable, key: SettingsKey, actor: Actor, now: Date): Promise<void> {
  await ensureSettingsRows(db);
  const { rows } = await db.query<{ draft_value: unknown; published_value: unknown }>(
    'SELECT draft_value, published_value FROM settings WHERE key = $1',
    [key],
  );
  if (!rows[0]) throw notFound('That settings group does not exist.');
  const parsed = SETTINGS_SCHEMAS[key].safeParse(rows[0].draft_value);
  if (!parsed.success) {
    throw unprocessable('The draft has validation errors and cannot be published.', fieldErrors(parsed.error));
  }
  if (key === 'branding') await assertAssetsExist(db, parsed.data as SettingsValues['branding']);
  const changed = changedTopLevelKeys(rows[0].published_value, rows[0].draft_value);
  await db.query(
    `UPDATE settings SET published_value = draft_value, published_at = $2, published_by = $3 WHERE key = $1`,
    [key, now, actor.id],
  );
  await recordAudit(
    db,
    actor,
    {
      action: 'settings.published',
      summary: `Published ${key} settings`,
      entityType: 'settings',
      entityId: key,
      metadata: { changedFields: changed },
    },
    now,
  );
}

export async function discardDraft(db: Queryable, key: SettingsKey, actor: Actor, now: Date): Promise<void> {
  await ensureSettingsRows(db);
  await db.query(
    'UPDATE settings SET draft_value = published_value, updated_at = $2, updated_by = $3 WHERE key = $1',
    [key, now, actor.id],
  );
  await recordAudit(
    db,
    actor,
    { action: 'settings.draft_discarded', summary: `Discarded unpublished ${key} changes`, entityType: 'settings', entityId: key },
    now,
  );
}
