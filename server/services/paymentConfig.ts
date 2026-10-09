// Payment configuration: enabled currencies, enabled methods, currency-specific bank profiles and the
// Western Union configuration. Every change is validated on the server and written to the audit log.

import {
  CURRENCIES,
  CARD_UNAVAILABLE_LABEL,
  type Currency,
  type PaymentMethod,
} from '../../shared/constants';
import { SENSITIVE_BANK_KEYS, validateBankFields } from '../../shared/bank';
import { westernUnionConfigSchema, WU_DEFAULT_CONFIG, type WesternUnionConfig } from '../../shared/schemas';
import type { Queryable } from '../db/database';
import { badRequest, conflict, notFound, unprocessable } from '../lib/errors';
import { fieldErrors } from '../lib/validate';
import { recordAudit, maskBankFields, type Actor } from './audit';
import { requireUuid } from './common';

export interface CurrencyRow {
  code: Currency;
  name: string;
  enabled: boolean;
}

export interface BankProfileRow {
  id: string;
  currency: Currency;
  transferType: string;
  label: string;
  enabled: boolean;
  sortOrder: number;
  fields: Record<string, string>;
  archived: boolean;
  inUse: boolean;
  updatedAt: string;
}

export interface WesternUnionState {
  enabled: boolean;
  config: WesternUnionConfig;
  ready: boolean;
  missing: string[];
}

const CURRENCY_NAME: Record<Currency, string> = {
  USD: 'United States Dollar',
  CAD: 'Canadian Dollar',
  EUR: 'Euro',
  GBP: 'British Pound Sterling',
};

export async function listCurrencies(db: Queryable): Promise<CurrencyRow[]> {
  const { rows } = await db.query<{ code: Currency; enabled: boolean }>('SELECT code, enabled FROM currencies');
  const byCode = new Map(rows.map((row) => [row.code, row.enabled]));
  return CURRENCIES.map((code) => ({ code, name: CURRENCY_NAME[code], enabled: byCode.get(code) ?? false }));
}

export async function isCurrencyEnabled(db: Queryable, code: Currency): Promise<boolean> {
  const { rows } = await db.query<{ enabled: boolean }>('SELECT enabled FROM currencies WHERE code = $1', [code]);
  return rows[0]?.enabled === true;
}

export async function setCurrencyEnabled(
  db: Queryable,
  code: string,
  enabled: boolean,
  actor: Actor,
  now: Date,
): Promise<void> {
  if (!(CURRENCIES as readonly string[]).includes(code)) throw notFound('Unknown currency.');
  await db.query('UPDATE currencies SET enabled = $2, updated_at = $3, updated_by = $4 WHERE code = $1', [
    code,
    enabled,
    now,
    actor.id,
  ]);
  await recordAudit(
    db,
    actor,
    {
      action: 'payment_config.currency',
      summary: `${enabled ? 'Enabled' : 'Disabled'} ${code} for payments`,
      entityType: 'currency',
      entityId: code,
      metadata: { enabled },
    },
    now,
  );
}

export async function listMethodStates(db: Queryable): Promise<Record<PaymentMethod, boolean>> {
  const { rows } = await db.query<{ method: PaymentMethod; enabled: boolean }>(
    'SELECT method, enabled FROM payment_methods',
  );
  const out: Record<PaymentMethod, boolean> = { bank_transfer: false, western_union: false, card: false };
  for (const row of rows) out[row.method] = row.enabled;
  return out;
}

export function westernUnionReadiness(config: WesternUnionConfig): string[] {
  const missing: string[] = [];
  if (!config.recipientName) missing.push('Recipient name');
  if (!config.recipientCountry) missing.push('Recipient country');
  if (!config.instructions) missing.push('Transfer instructions');
  if (config.supportedCurrencies.length === 0) missing.push('At least one supported currency');
  if (config.supportedCountries.length === 0) missing.push('At least one supported sending country');
  return missing;
}

export async function getWesternUnion(db: Queryable): Promise<WesternUnionState> {
  const { rows } = await db.query<{ enabled: boolean; config: unknown }>(
    'SELECT enabled, config FROM western_union_config WHERE id = 1',
  );
  const stored = (rows[0]?.config ?? {}) as Partial<WesternUnionConfig>;
  const parsed = westernUnionConfigSchema.safeParse({ ...WU_DEFAULT_CONFIG, ...stored });
  const config = parsed.success ? parsed.data : WU_DEFAULT_CONFIG;
  const missing = westernUnionReadiness(config);
  return { enabled: rows[0]?.enabled ?? false, config, ready: missing.length === 0, missing };
}

export async function saveWesternUnion(
  db: Queryable,
  input: { enabled: boolean; config: unknown },
  actor: Actor,
  now: Date,
): Promise<WesternUnionState> {
  const parsed = westernUnionConfigSchema.safeParse(input.config);
  if (!parsed.success) throw unprocessable('Please correct the Western Union settings.', fieldErrors(parsed.error));
  const missing = westernUnionReadiness(parsed.data);
  if (input.enabled && missing.length > 0) {
    throw unprocessable('Complete these fields before enabling Western Union.', {
      _form: `Missing: ${missing.join(', ')}`,
    });
  }
  const before = await getWesternUnion(db);
  await db.query(
    `UPDATE western_union_config SET enabled = $1, config = $2::jsonb, updated_at = $3, updated_by = $4 WHERE id = 1`,
    [input.enabled, JSON.stringify(parsed.data), now, actor.id],
  );
  const changed = Object.keys(parsed.data).filter(
    (key) => JSON.stringify((before.config as Record<string, unknown>)[key]) !== JSON.stringify((parsed.data as Record<string, unknown>)[key]),
  );
  await recordAudit(
    db,
    actor,
    {
      action: 'payment_config.western_union',
      summary: `Western Union settings saved (${input.enabled ? 'enabled' : 'disabled'})`,
      entityType: 'western_union',
      metadata: { changedFields: changed, enabled: input.enabled },
    },
    now,
  );
  return getWesternUnion(db);
}

export async function setMethodEnabled(
  db: Queryable,
  method: string,
  enabled: boolean,
  actor: Actor,
  now: Date,
): Promise<void> {
  if (method === 'card') {
    if (enabled) {
      throw conflict(
        'Card payments cannot be enabled yet. A supported payment processor must be connected and regional eligibility verified first.',
      );
    }
    return;
  }
  if (method !== 'bank_transfer' && method !== 'western_union') throw notFound('Unknown payment method.');

  if (enabled && method === 'bank_transfer') {
    const { rows } = await db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM bank_profiles WHERE enabled AND archived_at IS NULL`,
    );
    if (rows[0].count === 0) {
      throw unprocessable('Add and enable at least one complete bank profile before enabling bank transfers.', {
        _form: 'No enabled bank profile.',
      });
    }
  }
  if (enabled && method === 'western_union') {
    const state = await getWesternUnion(db);
    if (!state.ready) {
      throw unprocessable('Complete the Western Union configuration before enabling it.', {
        _form: `Missing: ${state.missing.join(', ')}`,
      });
    }
  }
  await db.query('UPDATE payment_methods SET enabled = $2, updated_at = $3, updated_by = $4 WHERE method = $1', [
    method,
    enabled,
    now,
    actor.id,
  ]);
  await recordAudit(
    db,
    actor,
    {
      action: 'payment_config.method',
      summary: `${enabled ? 'Enabled' : 'Disabled'} ${method} payments`,
      entityType: 'payment_method',
      entityId: method,
      metadata: { enabled },
    },
    now,
  );
}

export async function listBankProfiles(db: Queryable, currency?: Currency): Promise<BankProfileRow[]> {
  const params: unknown[] = [];
  let where = '';
  if (currency) {
    params.push(currency);
    where = 'WHERE p.currency = $1';
  }
  const { rows } = await db.query<{
    id: string;
    currency: Currency;
    transfer_type: string;
    label: string;
    enabled: boolean;
    sort_order: number;
    fields: Record<string, string>;
    archived_at: Date | null;
    in_use: boolean;
    updated_at: Date;
  }>(
    `SELECT p.id, p.currency, p.transfer_type, p.label, p.enabled, p.sort_order, p.fields, p.archived_at, p.updated_at,
            EXISTS (SELECT 1 FROM payment_references r WHERE r.bank_profile_id = p.id) AS in_use
       FROM bank_profiles p ${where}
      ORDER BY p.currency, p.sort_order, p.label`,
    params,
  );
  return rows.map((row) => ({
    id: row.id,
    currency: row.currency,
    transferType: row.transfer_type,
    label: row.label,
    enabled: row.enabled,
    sortOrder: row.sort_order,
    fields: row.fields,
    archived: row.archived_at !== null,
    inUse: row.in_use,
    updatedAt: new Date(row.updated_at).toISOString(),
  }));
}

export async function getBankProfile(db: Queryable, id: string): Promise<BankProfileRow> {
  const profile = (await listBankProfiles(db)).find((row) => row.id === requireUuid(id, 'bank profile'));
  if (!profile) throw notFound('That bank profile does not exist.');
  return profile;
}

const SENSITIVE_SET = new Set<string>(SENSITIVE_BANK_KEYS);

export async function createBankProfile(
  db: Queryable,
  input: {
    currency: Currency;
    transferType: string;
    label: string;
    enabled: boolean;
    sortOrder: number;
    fields: Record<string, string>;
  },
  actor: Actor,
  now: Date,
): Promise<BankProfileRow> {
  const validation = validateBankFields(input.currency, input.transferType, input.fields);
  if (input.enabled && !validation.valid) {
    throw unprocessable('This bank profile is incomplete. Fix the fields below before enabling it.', validation.errors);
  }
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO bank_profiles (currency, transfer_type, label, enabled, sort_order, fields, created_at, updated_at, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $7, $8) RETURNING id`,
    [
      input.currency,
      input.transferType,
      input.label,
      input.enabled && validation.valid,
      input.sortOrder,
      JSON.stringify(validation.valid ? validation.values : {}),
      now,
      actor.id,
    ],
  );
  await recordAudit(
    db,
    actor,
    {
      action: 'bank_profile.created',
      summary: `Created ${input.currency} bank profile "${input.label}"`,
      entityType: 'bank_profile',
      entityId: rows[0].id,
      metadata: { currency: input.currency, transferType: input.transferType, enabled: input.enabled, fields: maskBankFields(validation.values) },
    },
    now,
  );
  return getBankProfile(db, rows[0].id);
}

export async function updateBankProfile(
  db: Queryable,
  id: string,
  patch: Partial<{
    transferType: string;
    label: string;
    enabled: boolean;
    sortOrder: number;
    fields: Record<string, string>;
    confirmSensitiveChange: boolean;
  }>,
  actor: Actor,
  now: Date,
): Promise<BankProfileRow> {
  const current = await getBankProfile(db, id);
  if (current.archived) throw conflict('Archived bank profiles cannot be edited. Create a new profile instead.');
  const transferType = patch.transferType ?? current.transferType;
  const nextFields = patch.fields ?? current.fields;
  const validation = validateBankFields(current.currency, transferType, nextFields);

  const changedSensitive = Object.keys(validation.values).filter(
    (key) => SENSITIVE_SET.has(key) && validation.values[key] !== current.fields[key],
  );
  const transferChanged = transferType !== current.transferType;
  if ((changedSensitive.length > 0 || transferChanged) && current.inUse && !patch.confirmSensitiveChange) {
    throw unprocessable('Confirm the change to beneficiary or account details before saving.', {
      confirmSensitiveChange: 'Tick the confirmation to save beneficiary or account changes.',
    });
  }

  const enabled = patch.enabled ?? current.enabled;
  if (enabled && !validation.valid) {
    throw unprocessable('This bank profile is incomplete. Fix the fields below before enabling it.', validation.errors);
  }

  await db.query(
    `UPDATE bank_profiles
        SET transfer_type = $2, label = $3, enabled = $4, sort_order = $5, fields = $6::jsonb,
            updated_at = $7, updated_by = $8
      WHERE id = $1`,
    [
      id,
      transferType,
      patch.label ?? current.label,
      enabled,
      patch.sortOrder ?? current.sortOrder,
      JSON.stringify(validation.valid ? validation.values : nextFields),
      now,
      actor.id,
    ],
  );

  const changedFields = Object.keys({ ...current.fields, ...validation.values }).filter(
    (key) => (current.fields[key] ?? '') !== (validation.values[key] ?? ''),
  );
  await recordAudit(
    db,
    actor,
    {
      action: changedSensitive.length > 0 || transferChanged ? 'bank_profile.sensitive_change' : 'bank_profile.updated',
      summary: `Updated ${current.currency} bank profile "${patch.label ?? current.label}"`,
      entityType: 'bank_profile',
      entityId: id,
      metadata: {
        currency: current.currency,
        transferTypeFrom: current.transferType,
        transferTypeTo: transferType,
        enabledFrom: current.enabled,
        enabledTo: enabled,
        changedFields,
        before: maskBankFields(current.fields),
        after: maskBankFields(validation.values),
      },
    },
    now,
  );
  return getBankProfile(db, id);
}

export async function deleteBankProfile(db: Queryable, id: string, actor: Actor, now: Date): Promise<'deleted' | 'archived'> {
  const profile = await getBankProfile(db, id);
  if (profile.inUse) {
    await db.query('UPDATE bank_profiles SET archived_at = $2, enabled = false, updated_at = $2, updated_by = $3 WHERE id = $1', [
      id,
      now,
      actor.id,
    ]);
    await recordAudit(
      db,
      actor,
      {
        action: 'bank_profile.archived',
        summary: `Archived ${profile.currency} bank profile "${profile.label}" (used by payment history)`,
        entityType: 'bank_profile',
        entityId: id,
      },
      now,
    );
    return 'archived';
  }
  await db.query('DELETE FROM bank_profiles WHERE id = $1', [id]);
  await recordAudit(
    db,
    actor,
    {
      action: 'bank_profile.deleted',
      summary: `Deleted ${profile.currency} bank profile "${profile.label}"`,
      entityType: 'bank_profile',
      entityId: id,
    },
    now,
  );
  return 'deleted';
}

export function cardStatus(): { available: false; label: string; note: string } {
  return {
    available: false,
    label: CARD_UNAVAILABLE_LABEL,
    note: 'No payment processor is connected. Card payments stay unavailable until one is configured and eligibility is verified.',
  };
}

export function assertValidCurrency(value: string): Currency {
  if (!(CURRENCIES as readonly string[]).includes(value)) throw badRequest('Unsupported currency.');
  return value as Currency;
}
