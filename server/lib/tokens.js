import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { run, get, isoNow } from '../db.js';
import { config } from '../config.js';

const ACCESS_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateAccessCode(length = 8) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ACCESS_CODE_ALPHABET[bytes[i] % ACCESS_CODE_ALPHABET.length];
  }
  return out;
}

export function hashAccessCode(code) {
  return bcrypt.hashSync(code, 10);
}

export function verifyAccessCode(code, hash) {
  try {
    return bcrypt.compareSync(code, hash);
  } catch {
    return false;
  }
}

export function hashPassword(password) {
  return bcrypt.hashSync(password, 12);
}

export function verifyPassword(password, hash) {
  try {
    return bcrypt.compareSync(password, hash);
  } catch {
    return false;
  }
}

/**
 * Create a persistent, revocable session. The raw token is returned to the
 * caller exactly once (it is set as an HttpOnly cookie); only its SHA-256 hash
 * is stored.
 */
export async function createSession({ actorType, actorId, ip, userAgent }) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(
    Date.now() + config.sessionTtlHours * 60 * 60 * 1000
  ).toISOString();
  await run(
    `INSERT INTO sessions (token_hash, actor_type, actor_id, expires_at, ip, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [hashToken(token), actorType, actorId, expiresAt, ip || null, userAgent || null, isoNow()]
  );
  return { token, expiresAt };
}

export async function findSession(token) {
  if (!token) return null;
  const row = await get(
    `SELECT * FROM sessions WHERE token_hash = ? AND revoked_at IS NULL`,
    [hashToken(token)]
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return row;
}

export async function revokeSession(token) {
  if (!token) return;
  await run('UPDATE sessions SET revoked_at = ? WHERE token_hash = ?', [isoNow(), hashToken(token)]);
}

export async function revokeSessionById(id) {
  await run('UPDATE sessions SET revoked_at = ? WHERE id = ?', [isoNow(), id]);
}

export async function revokeAllSessionsForActor(actorType, actorId) {
  await run(
    'UPDATE sessions SET revoked_at = ? WHERE actor_type = ? AND actor_id = ? AND revoked_at IS NULL',
    [isoNow(), actorType, actorId]
  );
}
