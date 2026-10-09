import { findSession, revokeSession } from '../lib/tokens.js';
import { get, isoNow } from '../db.js';
import { unauthorized, forbidden, HttpError } from '../lib/http.js';

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

function loadAdmin(req) {
  if (req.admin) return req.admin;
  const token = req.cookies?.[ADMIN_COOKIE];
  const session = findSession(token);
  if (!session || session.actor_type !== 'admin') return null;
  const admin = get('SELECT * FROM admins WHERE id = ?', [session.actor_id]);
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

function loadClient(req) {
  if (req.portalClient) return req.portalClient;
  const token = req.cookies?.[CLIENT_COOKIE];
  const session = findSession(token);
  if (!session || session.actor_type !== 'client') return null;
  const client = get('SELECT * FROM clients WHERE id = ?', [session.actor_id]);
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

export function attachActors(req, _res, next) {
  try {
    loadAdmin(req);
    loadClient(req);
  } catch {
    /* ignore */
  }
  next();
}

export function requireAdmin(req, _res, next) {
  const admin = loadAdmin(req);
  if (!admin) return next(unauthorized('Administrator sign-in required.'));
  if (admin.mustChangePassword) {
    const allowed = [
      '/api/admin/auth/change-password',
      '/api/admin/auth/logout',
      '/api/admin/auth/me',
    ];
    const fullPath = `${req.baseUrl || ''}${req.path}`;
    if (!allowed.includes(fullPath)) {
      return next(
        new HttpError(403, 'You must change your initial password before continuing.', 'must_change_password')
      );
    }
  }
  next();
}

/** Restrict an admin route to specific roles (e.g. configuration changes). */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.admin) return next(unauthorized('Administrator sign-in required.'));
    if (!roles.includes(req.admin.role)) {
      return next(forbidden('This action requires a more privileged administrator role.'));
    }
    next();
  };
}

export function requireClient(req, _res, next) {
  const client = loadClient(req);
  if (!client) return next(unauthorized('Client sign-in required.'));
  next();
}

export { revokeSession, isoNow };
