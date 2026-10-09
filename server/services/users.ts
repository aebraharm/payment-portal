// Administrator accounts and roles. Roles are enforced on the server; the UI only hides controls.

import type { Role } from '../../shared/constants';
import type { Deps } from '../deps';
import type { Queryable } from '../db/database';
import { conflict, notFound, unprocessable } from '../lib/errors';
import { issueOneTimeToken } from '../security/oneTimeTokens';
import { revokeSessionsFor } from '../security/sessions';
import { recordAudit, type Actor } from './audit';
import { brandContext, notifySafely } from './notifications';

export interface AdminUserRow {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: 'invited' | 'active' | 'disabled';
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export async function listAdminUsers(db: Queryable): Promise<AdminUserRow[]> {
  const { rows } = await db.query<{
    id: string;
    email: string;
    display_name: string;
    role: Role;
    status: AdminUserRow['status'];
    must_change_password: boolean;
    last_login_at: Date | null;
    created_at: Date;
  }>(
    `SELECT id, email, display_name, role, status, must_change_password, last_login_at, created_at
       FROM admin_users ORDER BY created_at ASC`,
  );
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    mustChangePassword: row.must_change_password,
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

async function setupLinkFor(deps: Deps, adminId: string, actor: Actor, purpose: 'admin_invitation' | 'admin_password_reset') {
  const issued = await issueOneTimeToken(deps.db, {
    purpose,
    subjectId: adminId,
    createdBy: actor.id,
    ttlMinutes: purpose === 'admin_invitation' ? 7 * 24 * 60 : 30,
    now: deps.now(),
  });
  return { url: `${deps.config.appUrl}/admin/reset-password#token=${issued.token}`, expiresAt: issued.expiresAt.toISOString() };
}

export async function createAdminUser(
  deps: Deps,
  input: { email: string; displayName: string; role: Role },
  actor: Actor,
): Promise<{ id: string; setupUrl: string; expiresAt: string; notification: string }> {
  const { db } = deps;
  const now = deps.now();
  const email = input.email.toLowerCase();
  const existing = await db.query('SELECT 1 FROM admin_users WHERE email = $1', [email]);
  if (existing.rowCount > 0) throw unprocessable('An administrator with this email already exists.', { email: 'Already in use.' });
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO admin_users (email, display_name, role, status, must_change_password, created_at, updated_at)
     VALUES ($1, $2, $3, 'invited', true, $4, $4) RETURNING id`,
    [email, input.displayName, input.role, now],
  );
  const link = await setupLinkFor(deps, rows[0].id, actor, 'admin_invitation');
  const brand = await brandContext(deps);
  const outcome = await notifySafely(deps, {
    templateKey: 'admin_invitation',
    recipient: { type: 'admin', address: email },
    context: { resetUrl: link.url, agencyName: brand.agencyName },
    dedupeKey: null,
  });
  await recordAudit(
    db,
    actor,
    { action: 'admin_user.created', summary: `Invited administrator with role ${input.role}`, entityType: 'admin_user', entityId: rows[0].id, metadata: { role: input.role, notification: outcome } },
    now,
  );
  return { id: rows[0].id, setupUrl: link.url, expiresAt: link.expiresAt, notification: outcome };
}

async function assertNotLastSuperAdmin(db: Queryable, adminId: string): Promise<void> {
  const { rows } = await db.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM admin_users WHERE role = 'super_admin' AND status = 'active' AND id <> $1`,
    [adminId],
  );
  if (rows[0].count === 0) throw conflict('At least one active super administrator is required.');
}

export async function updateAdminUser(
  deps: Deps,
  id: string,
  patch: { role?: Role; status?: 'active' | 'disabled' },
  actor: Actor,
): Promise<void> {
  const { db } = deps;
  const now = deps.now();
  const { rows } = await db.query<{ role: Role; status: string }>('SELECT role, status FROM admin_users WHERE id = $1', [id]);
  const current = rows[0];
  if (!current) throw notFound('That administrator does not exist.');
  if (actor.id === id && (patch.role !== undefined || patch.status === 'disabled')) {
    throw conflict('You cannot change your own role or disable your own account.');
  }
  const nextRole = patch.role ?? current.role;
  const nextStatus = patch.status ?? current.status;
  const losingSuper =
    current.role === 'super_admin' && current.status === 'active' && (nextRole !== 'super_admin' || nextStatus !== 'active');
  if (losingSuper) await assertNotLastSuperAdmin(db, id);

  await db.query('UPDATE admin_users SET role = $2, status = $3, updated_at = $4 WHERE id = $1', [id, nextRole, nextStatus, now]);
  if (nextStatus === 'disabled') await revokeSessionsFor(db, { actorType: 'admin', actorId: id, now });
  await recordAudit(
    db,
    actor,
    {
      action: 'admin_user.updated',
      summary: `Updated administrator access`,
      entityType: 'admin_user',
      entityId: id,
      metadata: { roleFrom: current.role, roleTo: nextRole, statusFrom: current.status, statusTo: nextStatus },
    },
    now,
  );
}

export async function issueAdminResetLink(deps: Deps, id: string, actor: Actor): Promise<{ url: string; expiresAt: string }> {
  const { db } = deps;
  const { rows } = await db.query<{ status: string; email: string }>('SELECT status, email FROM admin_users WHERE id = $1', [id]);
  if (!rows[0]) throw notFound('That administrator does not exist.');
  if (rows[0].status === 'disabled') throw conflict('Enable the account before issuing a reset link.');
  const link = await setupLinkFor(deps, id, actor, 'admin_password_reset');
  await recordAudit(db, actor, { action: 'admin_user.reset_link', summary: 'Issued a password reset link', entityType: 'admin_user', entityId: id }, deps.now());
  return link;
}
