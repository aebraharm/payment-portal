import { findSession, revokeSession } from '../lib/tokens.js';
import { get, isoNow } from '../db.js';
import { asyncHandler, unauthorized, forbidden, HttpError } from '../lib/http.js';

export const ADMIN_COOKIE = 'admin_session';
export const CLIENT_COOKIE = 'client_session';

export function setSessionCookie(res, cookieName, token, expiresAt) {
  res.cookie(cookieName, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    expires: new Date(expiresAt),
    path: '/',
  });
}

export function clearSessionCookie(res, cookieName) {
  res.clearCookie(cookieName, { httpOnly: true, sameSite: 'strict', path: '/' });
}

async function loadAdmin(req) {
  if (req.admin) return req.admin;
  const token = req.cookies?.[ADMIN_COOKIE];
  const session = await findSession(token);
  if (!session || session.actor_type !== 'admin') return null;
  const admin = await get('SELECT * FROM admins WHERE id = ?', [session.actor_id]);
  if (!admin || admin.status !== 'active') return null;
  req.adminSession = session;
  req.admin = {
    id: admin.id,
    email: admin.email,
    role: admin.role,
    fullName: admin.full_name,
    mustChangePassword: !!admin.must_change_password,
  };
  return req.admin;
}

async function loadClient(req) {
  if (req.portalClient) return req.portalClient;
  const token = req.cookies?.[CLIENT_COOKIE];
  const session = await findSession(token);
  if (!session || session.actor_type !== 'client') return null;
  const client = await get('SELECT * FROM clients WHERE id = ?', [session.actor_id]);
  if (!client || client.status !== 'active') return null;
  req.clientSession = session;
  req.portalClient = {
    id: client.id,
    clientCode: client.client_code,
    fullName: client.full_name,
    email: client.email,
    phone: client.phone,
  };
  return req.portalClient;
}

/**
 * Resolve both possible actors for a request.
 *
 * Never loads a session twice: a route that later calls `requireAdmin` reuses
 * `req.admin`. Failures are swallowed here on purpose — an unreadable cookie
 * must produce a normal 401 from the protected route, not a 500 from
 * middleware. The session lookup is a database read on the serverless host, so
 * it is awaited rather than fired and forgotten.
 */
export const attachActors = asyncHandler(async (req, _res, next) => {
  try {
    await Promise.all([loadAdmin(req), loadClient(req)]);
  } catch {
    /* ignore */
  }
  next();
});

/**
 * Resolve the actor again (cheap when `attachActors` already did) and enforce
 * the sign-in and password-change rules. Exported as middleware, so it is
 * wrapped in `asyncHandler`: Express 4 does not catch rejections from an async
 * middleware, and an uncaught one would hang the request instead of returning
 * the 401/403 the client expects.
 */
export const requireAdmin = asyncHandler(async (req, _res, next) => {
  const admin = await loadAdmin(req);
  if (!admin) return next(unauthorized('Administrator sign-in required.'));
  if (admin.mustChangePassword) {
    const allowed = ['/api/admin/auth/change-password', '/api/admin/auth/logout', '/api/admin/auth/me'];
    const fullPath = `${req.baseUrl || ''}${req.path}`;
    if (!allowed.includes(fullPath)) {
      return next(
        new HttpError(403, 'You must change your initial password before continuing.', 'must_change_password')
      );
    }
  }
  next();
});

/** Restrict an admin route to specific roles (e.g. configuration changes). */
export function requireRole(...roles) {
  return asyncHandler(async (req, _res, next) => {
    if (!req.admin) {
      const admin = await loadAdmin(req);
      if (!admin) return next(unauthorized('Administrator sign-in required.'));
    }
    if (!roles.includes(req.admin.role)) {
      return next(forbidden('This action requires a more privileged administrator role.'));
    }
    next();
  });
}

export const requireClient = asyncHandler(async (req, _res, next) => {
  const client = await loadClient(req);
  if (!client) return next(unauthorized('Client sign-in required.'));
  next();
});

/**
 * True when the request carries a live client session. Used by routes that
 * behave differently for a signed-in client without rejecting an anonymous
 * visitor (e.g. the public branding endpoint).
 */
export async function currentClient(req) {
  return loadClient(req);
}

export async function currentAdmin(req) {
  return loadAdmin(req);
}

export { revokeSession, isoNow };
