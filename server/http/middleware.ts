// Authentication, CSRF and authorisation middleware. Every protected route passes through these checks;
// the browser's hidden state is never trusted.

import type { MiddlewareHandler } from 'hono';
import { ROLE_PERMISSIONS, type Permission, type Role } from '../../shared/constants';
import type { Deps } from '../deps';
import { AppError, forbidden, unauthorized } from '../lib/errors';
import { safeEqual } from '../lib/crypto';
import { findSession } from '../security/sessions';
import { isSameOrigin, ADMIN_COOKIE, CLIENT_COOKIE, sessionToken, type AppEnv } from './context';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function adminSession(deps: Deps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = sessionToken(c, ADMIN_COOKIE);
    if (!token) throw unauthorized();
    const session = await findSession(deps.db, token, 'admin', deps.now());
    if (!session || !session.adminId) throw unauthorized('Your session has ended. Sign in again.');
    const { rows } = await deps.db.query<{
      id: string;
      email: string;
      display_name: string;
      role: Role;
      status: string;
      must_change_password: boolean;
    }>('SELECT id, email, display_name, role, status, must_change_password FROM admin_users WHERE id = $1', [session.adminId]);
    const admin = rows[0];
    if (!admin || admin.status !== 'active') throw unauthorized('Your session has ended. Sign in again.');
    c.set('admin', {
      id: admin.id,
      email: admin.email,
      displayName: admin.display_name,
      role: admin.role,
      mustChangePassword: admin.must_change_password,
      sessionId: session.id,
      csrfToken: session.csrfToken,
      permissions: ROLE_PERMISSIONS[admin.role],
    });
    await next();
  };
}

export function clientSession(deps: Deps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = sessionToken(c, CLIENT_COOKIE);
    if (!token) throw unauthorized();
    const session = await findSession(deps.db, token, 'client', deps.now());
    if (!session || !session.clientId) throw unauthorized('Your session has ended. Sign in again.');
    const { rows } = await deps.db.query<{ id: string; full_name: string; client_code: string; status: string }>(
      'SELECT id, full_name, client_code, status FROM clients WHERE id = $1',
      [session.clientId],
    );
    const client = rows[0];
    if (!client || client.status !== 'active') throw unauthorized('Your session has ended. Sign in again.');
    c.set('client', {
      id: client.id,
      fullName: client.full_name,
      clientCode: client.client_code,
      sessionId: session.id,
      csrfToken: session.csrfToken,
    });
    await next();
  };
}

/** Requires the session's CSRF token in a header for state-changing requests, plus a same-origin check. */
export function requireCsrf(deps: Deps, source: 'admin' | 'client'): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();
    if (!isSameOrigin(c, deps.config.appUrl)) {
      throw forbidden('This request came from an unexpected website. Refresh the page and try again.');
    }
    const expected = source === 'admin' ? c.get('admin').csrfToken : c.get('client').csrfToken;
    const provided = c.req.header('x-csrf-token') ?? '';
    if (!provided || !safeEqual(provided, expected)) {
      throw new AppError(403, 'CSRF_FAILED', 'Your session check failed. Refresh the page and try again.');
    }
    await next();
  };
}

export function requirePermission(permission: Permission): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const admin = c.get('admin');
    if (admin.mustChangePassword) {
      throw new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Choose a new password before continuing.');
    }
    if (!admin.permissions.includes(permission)) {
      throw forbidden('Your role does not allow this action.');
    }
    await next();
  };
}

/** Blocks everything except password management while a forced password change is pending. */
export function requireNoPendingPasswordChange(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.get('admin').mustChangePassword) {
      throw new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Choose a new password before continuing.');
    }
    await next();
  };
}
