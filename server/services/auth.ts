// Authentication flows for administrators and clients. Responses for unknown accounts, wrong secrets and
// inactive accounts are identical, and failed attempts are rate limited per account and per IP.

import { ACCESS_CODE_MIN_LENGTH, ADMIN_PASSWORD_MIN_LENGTH } from '../../shared/constants';
import type { Deps } from '../deps';
import type { Queryable } from '../db/database';
import { AppError, badRequest, forbidden, tooManyRequests, unprocessable } from '../lib/errors';
import { hmacSha256 } from '../lib/crypto';
import { log } from '../lib/logger';
import { burnVerificationTime, hashSecret, verifySecret } from '../security/passwords';
import { clearRateLimit, hitRateLimit } from '../security/rateLimit';
import { createSession, revokeSessionByToken, revokeSessionsFor } from '../security/sessions';
import { issueOneTimeToken, redeemOneTimeToken } from '../security/oneTimeTokens';
import { recordAudit, type Actor } from './audit';
import { normalizeLoginName } from './clients';
import { brandContext, enqueueNotification } from './notifications';

const INVALID_ADMIN = 'Email or password is incorrect.';
const INVALID_CLIENT = 'Those details do not match our records. If you were sent an activation link, use it to set your access code first.';

export function ipHashFor(deps: Deps, ip: string | null): string {
  return hmacSha256(deps.config.appSecret, ip ?? 'unknown');
}

function minutesText(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  return minutes <= 1 ? 'about a minute' : `about ${minutes} minutes`;
}

async function enforceLimit(db: Queryable, key: string, max: number, deps: Deps, message: string): Promise<void> {
  const decision = await hitRateLimit(db, key, max, deps.config.rateLimits.windowMs, deps.now());
  if (!decision.allowed) {
    throw tooManyRequests(`${message} Try again in ${minutesText(decision.retryAfterSeconds)}.`, decision.retryAfterSeconds);
  }
}

export interface AdminSession {
  adminId: string;
  token: string;
  csrfToken: string;
  expiresAt: Date;
  mustChangePassword: boolean;
  email: string;
  displayName: string;
  role: string;
}

export async function adminLogin(deps: Deps, input: { email: string; password: string; ip: string | null }): Promise<AdminSession> {
  const { db, config } = deps;
  const now = deps.now();
  const email = input.email.trim().toLowerCase();
  const ipHash = ipHashFor(deps, input.ip);
  await enforceLimit(db, `admin-login:ip:${ipHash}`, config.rateLimits.adminLoginPerIp, deps, 'Too many sign-in attempts from this network.');
  await enforceLimit(db, `admin-login:email:${email}`, config.rateLimits.adminLoginPerEmail, deps, 'Too many failed sign-in attempts for this account.');

  const { rows } = await db.query<{
    id: string;
    email: string;
    display_name: string;
    role: string;
    status: string;
    password_hash: string | null;
    must_change_password: boolean;
  }>(
    `SELECT id, email, display_name, role, status, password_hash, must_change_password FROM admin_users WHERE email = $1`,
    [email],
  );
  const admin = rows[0];
  const usable = admin && admin.status === 'active' && admin.password_hash;
  const passwordOk = usable ? await verifySecret(input.password, admin.password_hash) : (await burnVerificationTime(input.password), false);
  if (!usable || !passwordOk || !admin) {
    await recordAudit(db, { type: 'anonymous', id: null, ipHash }, {
      action: 'admin.login_failed',
      summary: 'Failed administrator sign-in',
      metadata: { accountFound: Boolean(admin) },
    }, now);
    throw new AppError(401, 'INVALID_CREDENTIALS', INVALID_ADMIN);
  }

  const session = await db.transaction(async (tx) => {
    await tx.query('UPDATE admin_users SET last_login_at = $2 WHERE id = $1', [admin.id, now]);
    const created = await createSession(tx, {
      actorType: 'admin',
      actorId: admin.id,
      ttlHours: config.adminSessionHours,
      now,
      ipHash,
    });
    await recordAudit(tx, { type: 'admin', id: admin.id, ipHash }, { action: 'admin.login', summary: 'Administrator signed in' }, now);
    return created;
  });
  await clearRateLimit(db, `admin-login:email:${email}`);
  log('info', 'admin.login', { adminId: admin.id });
  return {
    adminId: admin.id,
    token: session.token,
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
    mustChangePassword: admin.must_change_password,
    email: admin.email,
    displayName: admin.display_name,
    role: admin.role,
  };
}

export async function adminLogout(deps: Deps, token: string, actor: Actor): Promise<void> {
  const now = deps.now();
  await revokeSessionByToken(deps.db, token, now);
  await recordAudit(deps.db, actor, { action: 'admin.logout', summary: 'Administrator signed out' }, now);
}

export async function adminChangePassword(
  deps: Deps,
  input: { adminId: string; sessionId: string; currentPassword: string; newPassword: string },
): Promise<void> {
  const { db } = deps;
  const now = deps.now();
  if (input.newPassword.length < ADMIN_PASSWORD_MIN_LENGTH) {
    throw unprocessable('Choose a longer password.', { newPassword: `Use at least ${ADMIN_PASSWORD_MIN_LENGTH} characters.` });
  }
  const { rows } = await db.query<{ password_hash: string | null }>('SELECT password_hash FROM admin_users WHERE id = $1', [input.adminId]);
  const ok = await verifySecret(input.currentPassword, rows[0]?.password_hash);
  if (!ok) throw unprocessable('Your current password is incorrect.', { currentPassword: 'Check the password and try again.' });
  if (input.currentPassword === input.newPassword) {
    throw unprocessable('Choose a password that is different from your current one.', { newPassword: 'Must be different.' });
  }
  const hash = await hashSecret(input.newPassword);
  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE admin_users SET password_hash = $2, must_change_password = false, password_changed_at = $3, updated_at = $3 WHERE id = $1`,
      [input.adminId, hash, now],
    );
    await revokeSessionsFor(tx, { actorType: 'admin', actorId: input.adminId, now, exceptSessionId: input.sessionId });
    await recordAudit(tx, { type: 'admin', id: input.adminId }, { action: 'admin.password_changed', summary: 'Administrator changed password' }, now);
  });
}

export async function requestAdminPasswordReset(deps: Deps, input: { email: string; ip: string | null }): Promise<void> {
  const { db, config } = deps;
  const now = deps.now();
  const email = input.email.trim().toLowerCase();
  const decision = await hitRateLimit(db, `admin-reset:email:${email}`, config.rateLimits.resetRequestsPerEmail, config.rateLimits.windowMs, now);
  // Always respond the same way so the form cannot be used to discover which emails are registered.
  if (!decision.allowed) return;
  const { rows } = await db.query<{ id: string; status: string }>('SELECT id, status FROM admin_users WHERE email = $1', [email]);
  const admin = rows[0];
  if (admin && admin.status === 'active') {
    const issued = await issueOneTimeToken(db, {
      purpose: 'admin_password_reset',
      subjectId: admin.id,
      createdBy: null,
      ttlMinutes: 30,
      now,
    });
    await enqueueNotification(deps, {
      templateKey: 'admin_password_reset',
      recipient: { type: 'admin', address: email },
      context: { resetUrl: `${config.appUrl}/admin/reset-password#token=${issued.token}`, agencyName: (await brandContext(deps)).agencyName },
      dedupeKey: null,
    });
  }
  await recordAudit(db, { type: 'anonymous', id: null, ipHash: ipHashFor(deps, input.ip) }, {
    action: 'admin.password_reset_requested',
    summary: 'Password reset requested',
    metadata: { accountFound: Boolean(admin) },
  }, now);
}

export async function confirmAdminPasswordLink(deps: Deps, input: { token: string; newPassword: string }): Promise<void> {
  const { db } = deps;
  const now = deps.now();
  if (input.newPassword.length < ADMIN_PASSWORD_MIN_LENGTH) {
    throw unprocessable('Choose a longer password.', { newPassword: `Use at least ${ADMIN_PASSWORD_MIN_LENGTH} characters.` });
  }
  const hash = await hashSecret(input.newPassword);
  await db.transaction(async (tx) => {
    let adminId: string | null = null;
    for (const purpose of ['admin_invitation', 'admin_password_reset'] as const) {
      adminId = await redeemOneTimeToken(tx, { purpose, token: input.token, now });
      if (adminId) break;
    }
    if (!adminId) throw badRequest('This link is invalid or has expired. Ask an administrator for a new one.');
    const { rows } = await tx.query<{ status: string }>('SELECT status FROM admin_users WHERE id = $1 FOR UPDATE', [adminId]);
    if (!rows[0] || rows[0].status === 'disabled') throw forbidden('This account cannot be used. Contact an administrator.');
    await tx.query(
      `UPDATE admin_users SET password_hash = $2, must_change_password = false, password_changed_at = $3,
              status = 'active', updated_at = $3 WHERE id = $1`,
      [adminId, hash, now],
    );
    await revokeSessionsFor(tx, { actorType: 'admin', actorId: adminId, now });
    await recordAudit(tx, { type: 'admin', id: adminId }, { action: 'admin.password_set', summary: 'Administrator set a password from a link' }, now);
  });
}

export interface ClientSession {
  clientId: string;
  token: string;
  csrfToken: string;
  expiresAt: Date;
  clientName: string;
}

export async function clientLogin(deps: Deps, input: { fullName: string; accessCode: string; ip: string | null }): Promise<ClientSession> {
  const { db, config } = deps;
  const now = deps.now();
  const loginName = normalizeLoginName(input.fullName);
  const ipHash = ipHashFor(deps, input.ip);
  await enforceLimit(db, `client-login:ip:${ipHash}`, config.rateLimits.clientLoginPerIp, deps, 'Too many sign-in attempts from this network.');
  await enforceLimit(db, `client-login:name:${loginName}`, config.rateLimits.clientLoginPerName, deps, 'Too many failed sign-in attempts for this account.');

  const { rows } = await db.query<{ id: string; full_name: string; status: string; access_code_hash: string | null }>(
    'SELECT id, full_name, status, access_code_hash FROM clients WHERE login_name = $1',
    [loginName],
  );
  const client = rows[0];
  const usable = client && client.status === 'active' && client.access_code_hash;
  const ok = usable ? await verifySecret(input.accessCode, client.access_code_hash) : (await burnVerificationTime(input.accessCode), false);
  if (!usable || !ok || !client) {
    await recordAudit(db, { type: 'anonymous', id: null, ipHash }, {
      action: 'client.login_failed',
      summary: 'Failed client sign-in',
      metadata: { accountFound: Boolean(client) },
    }, now);
    throw new AppError(401, 'INVALID_CREDENTIALS', INVALID_CLIENT);
  }

  const session = await db.transaction(async (tx) => {
    const created = await createSession(tx, {
      actorType: 'client',
      actorId: client.id,
      ttlHours: config.clientSessionHours,
      now,
      ipHash,
    });
    await recordAudit(tx, { type: 'client', id: client.id, ipHash }, { action: 'client.login', summary: 'Client signed in' }, now);
    return created;
  });
  await clearRateLimit(db, `client-login:name:${loginName}`);
  return {
    clientId: client.id,
    token: session.token,
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
    clientName: client.full_name,
  };
}

export async function clientChangeAccessCode(
  deps: Deps,
  input: { clientId: string; sessionId: string; currentAccessCode: string; newAccessCode: string },
): Promise<void> {
  const { db } = deps;
  const now = deps.now();
  if (input.newAccessCode.length < ACCESS_CODE_MIN_LENGTH) {
    throw unprocessable('Use a longer access code.', { newAccessCode: `Use at least ${ACCESS_CODE_MIN_LENGTH} characters.` });
  }
  const { rows } = await db.query<{ access_code_hash: string | null }>('SELECT access_code_hash FROM clients WHERE id = $1', [input.clientId]);
  const ok = await verifySecret(input.currentAccessCode, rows[0]?.access_code_hash);
  if (!ok) throw unprocessable('Your current access code is incorrect.', { currentAccessCode: 'Check the code and try again.' });
  if (input.currentAccessCode === input.newAccessCode) {
    throw unprocessable('Choose an access code that is different from your current one.', { newAccessCode: 'Must be different.' });
  }
  const hash = await hashSecret(input.newAccessCode);
  await db.transaction(async (tx) => {
    await tx.query('UPDATE clients SET access_code_hash = $2, access_code_set_at = $3, updated_at = $3 WHERE id = $1', [input.clientId, hash, now]);
    await revokeSessionsFor(tx, { actorType: 'client', actorId: input.clientId, now, exceptSessionId: input.sessionId });
    await recordAudit(tx, { type: 'client', id: input.clientId }, { action: 'client.access_code_changed', summary: 'Client changed access code' }, now);
  });
}
