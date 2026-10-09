// First administrator. Created from server-side environment variables by a one-time command. The
// password is hashed before it is stored, is never logged, and the account must change it at first sign-in.
// Running the command again is safe: if the account exists, nothing is changed.

import { BOOTSTRAP_PASSWORD_MIN_LENGTH } from '../../shared/constants';
import type { Deps } from '../deps';
import { hashSecret } from '../security/passwords';
import { recordAudit, SYSTEM_ACTOR } from './audit';

export type BootstrapResult = 'created' | 'exists' | 'skipped';

export async function bootstrapAdmin(deps: Deps): Promise<BootstrapResult> {
  const { email, password, name } = deps.config.bootstrap;
  if (!email && !password) return 'skipped';
  if (!email || !password) {
    throw new Error('Set both ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD, or neither.');
  }
  if (password.length < BOOTSTRAP_PASSWORD_MIN_LENGTH) {
    throw new Error(`ADMIN_BOOTSTRAP_PASSWORD must be at least ${BOOTSTRAP_PASSWORD_MIN_LENGTH} characters.`);
  }
  const normalized = email.trim().toLowerCase();
  const existing = await deps.db.query('SELECT id FROM admin_users WHERE email = $1', [normalized]);
  if (existing.rowCount > 0) return 'exists';

  const hash = await hashSecret(password);
  const now = deps.now();
  try {
    await deps.db.transaction(async (tx) => {
      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO admin_users (email, display_name, role, status, password_hash, must_change_password,
                                  password_changed_at, created_at, updated_at)
         VALUES ($1, $2, 'super_admin', 'active', $3, true, NULL, $4, $4)
         RETURNING id`,
        [normalized, name, hash, now],
      );
      await recordAudit(
        tx,
        SYSTEM_ACTOR,
        {
          action: 'admin.bootstrapped',
          summary: 'Initial super administrator created; password change required at first sign-in',
          entityType: 'admin_user',
          entityId: inserted.rows[0].id,
        },
        now,
      );
    });
  } catch (error) {
    // Another process created the account between the check and the insert.
    if ((error as { code?: string }).code === '23505') return 'exists';
    throw error;
  }
  return 'created';
}
