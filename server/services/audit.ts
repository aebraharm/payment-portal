// Append-only audit trail. Account-like values are masked and secret-like keys are removed before
// anything is written, so the trail is useful for review without exposing credentials.

import { SENSITIVE_BANK_KEYS } from '../../shared/bank';
import type { Queryable } from '../db/database';

export interface Actor {
  type: 'admin' | 'client' | 'system' | 'anonymous';
  id: string | null;
  ipHash?: string | null;
}

export interface AuditInput {
  action: string;
  summary: string;
  entityType?: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

const SECRET_KEY = /password|secret|token|access_?code|hash|csrf|cookie/i;

export function maskAccountValue(value: string): string {
  const trimmed = value.trim();
  return trimmed.length <= 4 ? '••••' : `••••${trimmed.slice(-4)}`;
}

/** Masks banking identifiers. Used for audit metadata so beneficiary changes are traceable without exposing account data. */
export function maskBankFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = SENSITIVE_BANK_KEYS.includes(key) && typeof value === 'string' ? maskAccountValue(value) : value;
  }
  return out;
}

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]';
  if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) continue;
      out[key] = sanitize(item, depth + 1);
    }
    return out;
  }
  return value;
}

export async function recordAudit(db: Queryable, actor: Actor, input: AuditInput, now: Date): Promise<void> {
  await db.query(
    `INSERT INTO audit_events (occurred_at, actor_type, actor_id, action, entity_type, entity_id, summary, metadata, ip_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
    [
      now,
      actor.type,
      actor.id,
      input.action,
      input.entityType ?? null,
      input.entityId ?? null,
      input.summary.slice(0, 500),
      JSON.stringify(sanitize(input.metadata ?? {})),
      actor.ipHash ?? null,
    ],
  );
}

export const SYSTEM_ACTOR: Actor = { type: 'system', id: null };
