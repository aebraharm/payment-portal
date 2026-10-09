// Single-use links for client activation and admin password setup or reset.
// Tokens are random, stored hashed, expire, and are redeemed atomically so a link works once.

import { randomToken, sha256 } from '../lib/crypto';
import type { Queryable } from '../db/database';

export type TokenPurpose = 'client_invitation' | 'admin_invitation' | 'admin_password_reset';

export async function issueOneTimeToken(
  db: Queryable,
  options: { purpose: TokenPurpose; subjectId: string; createdBy: string | null; ttlMinutes: number; now: Date },
): Promise<{ token: string; expiresAt: Date }> {
  // Invalidate earlier unused links for the same subject so only the newest one works.
  await db.query(
    `UPDATE one_time_tokens SET invalidated_at = $3
      WHERE purpose = $1 AND subject_id = $2 AND used_at IS NULL AND invalidated_at IS NULL`,
    [options.purpose, options.subjectId, options.now],
  );
  const token = randomToken(32);
  const expiresAt = new Date(options.now.getTime() + options.ttlMinutes * 60_000);
  await db.query(
    `INSERT INTO one_time_tokens (purpose, subject_id, token_hash, created_by, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [options.purpose, options.subjectId, sha256(token), options.createdBy, options.now, expiresAt],
  );
  return { token, expiresAt };
}

export async function inspectOneTimeToken(
  db: Queryable,
  options: { purpose: TokenPurpose; token: string; now: Date },
): Promise<{ subjectId: string; expiresAt: Date } | null> {
  const { rows } = await db.query<{ subject_id: string; expires_at: Date }>(
    `SELECT subject_id, expires_at FROM one_time_tokens
      WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND invalidated_at IS NULL AND expires_at > $3`,
    [sha256(options.token), options.purpose, options.now],
  );
  return rows[0] ? { subjectId: rows[0].subject_id, expiresAt: rows[0].expires_at } : null;
}

/** Marks the token used and returns its subject. Must run inside the same transaction as the change it authorises. */
export async function redeemOneTimeToken(
  db: Queryable,
  options: { purpose: TokenPurpose; token: string; now: Date },
): Promise<string | null> {
  const { rows } = await db.query<{ subject_id: string }>(
    `UPDATE one_time_tokens SET used_at = $4
      WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND invalidated_at IS NULL AND expires_at > $3
      RETURNING subject_id`,
    [sha256(options.token), options.purpose, options.now, options.now],
  );
  return rows[0]?.subject_id ?? null;
}
