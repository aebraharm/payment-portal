// Server-side sessions. The browser holds a random opaque token in an HttpOnly cookie. The database
// stores only its SHA-256 hash, so a database leak does not expose live sessions.

import { randomToken, sha256 } from '../lib/crypto';
import type { Queryable } from '../db/database';

export type ActorType = 'admin' | 'client';

export interface SessionRecord {
  id: string;
  csrfToken: string;
  expiresAt: Date;
  adminId: string | null;
  clientId: string | null;
}

export async function createSession(
  db: Queryable,
  options: { actorType: ActorType; actorId: string; ttlHours: number; now: Date; ipHash: string | null },
): Promise<{ token: string; csrfToken: string; expiresAt: Date; sessionId: string }> {
  const token = randomToken(32);
  const csrfToken = randomToken(32);
  const expiresAt = new Date(options.now.getTime() + options.ttlHours * 3_600_000);
  const column = options.actorType === 'admin' ? 'admin_id' : 'client_id';
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO sessions (actor_type, ${column}, token_hash, csrf_token, ip_hash, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [options.actorType, options.actorId, sha256(token), csrfToken, options.ipHash, options.now, expiresAt],
  );
  return { token, csrfToken, expiresAt, sessionId: rows[0].id };
}

export async function findSession(
  db: Queryable,
  token: string,
  actorType: ActorType,
  now: Date,
): Promise<SessionRecord | null> {
  const { rows } = await db.query<{
    id: string;
    csrf_token: string;
    expires_at: Date;
    admin_id: string | null;
    client_id: string | null;
  }>(
    `SELECT id, csrf_token, expires_at, admin_id, client_id FROM sessions
      WHERE token_hash = $1 AND actor_type = $2 AND revoked_at IS NULL AND expires_at > $3`,
    [sha256(token), actorType, now],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    csrfToken: row.csrf_token,
    expiresAt: row.expires_at,
    adminId: row.admin_id,
    clientId: row.client_id,
  };
}

export async function revokeSessionByToken(db: Queryable, token: string, now: Date): Promise<void> {
  await db.query('UPDATE sessions SET revoked_at = $2 WHERE token_hash = $1 AND revoked_at IS NULL', [
    sha256(token),
    now,
  ]);
}

export async function revokeSessionsFor(
  db: Queryable,
  options: { actorType: ActorType; actorId: string; now: Date; exceptSessionId?: string | null },
): Promise<number> {
  const column = options.actorType === 'admin' ? 'admin_id' : 'client_id';
  const result = await db.query(
    `UPDATE sessions SET revoked_at = $2
      WHERE ${column} = $1 AND revoked_at IS NULL AND ($3::uuid IS NULL OR id <> $3::uuid)`,
    [options.actorId, options.now, options.exceptSessionId ?? null],
  );
  return result.rowCount;
}
