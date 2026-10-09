import { Router } from 'express';
import { z } from 'zod';
import { get, run, isoNow, parseJson } from '../db.js';
import {
  createSession,
  verifyPassword,
  hashPassword,
  verifyAccessCode,
  revokeSession,
  revokeAllSessionsForActor,
} from '../lib/tokens.js';
import { asyncHandler, badRequest, unauthorized, forbidden, zodError } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { notifyFromTemplate } from '../lib/notify.js';
import { setSessionCookie, clearSessionCookie, ADMIN_COOKIE, CLIENT_COOKIE, requireAdmin, requireClient } from '../middleware/auth.js';
import { authLimiter } from '../middleware/security.js';

const router = Router();

const PASSWORD_MIN = 10;

function passwordSchema(field = 'newPassword') {
  return z
    .string()
    .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters.`)
    .max(72, 'Password must be at most 72 characters.');
}

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || null;
}

// ---------------------------------------------------------------- admin ----

router.post(
  '/admin/auth/login',
  authLimiter(),
  asyncHandler(async (req, res) => {
    const schema = z.object({
      email: z.string().email('A valid email is required.').transform((v) => v.trim().toLowerCase()),
      password: z.string().min(1, 'Password is required.'),
    });
    let body;
    try {
      body = schema.parse(req.body);
    } catch (e) {
      throw zodError(e);
    }

    const admin = get('SELECT * FROM admins WHERE email = ?', [body.email]);
    if (!admin || !verifyPassword(body.password, admin.password_hash)) {
      audit(req, {
        actor: { type: 'system', id: null },
        action: 'admin_login_failed',
        entity: 'admin',
        entityId: body.email,
        details: { email: body.email },
      });
      throw unauthorized('Invalid email or password.');
    }
    if (admin.status !== 'active') {
      throw forbidden('This administrator account is disabled.');
    }

    run('UPDATE admins SET last_login_at = ?, updated_at = ? WHERE id = ?', [isoNow(), isoNow(), admin.id]);
    const session = createSession({
      actorType: 'admin',
      actorId: admin.id,
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
    });
    setSessionCookie(res, ADMIN_COOKIE, session.token, session.expiresAt);
    audit(req, {
      actor: { type: 'admin', id: admin.id },
      action: 'admin_login',
      entity: 'admin',
      entityId: admin.id,
    });

    res.json({
      admin: {
        id: admin.id,
        email: admin.email,
        role: admin.role,
        fullName: admin.full_name,
      },
      mustChangePassword: !!admin.must_change_password,
    });
  })
);

router.post(
  '/admin/auth/logout',
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[ADMIN_COOKIE];
    revokeSession(token);
    clearSessionCookie(res, ADMIN_COOKIE);
    if (req.admin) {
      audit(req, { action: 'admin_logout', entity: 'admin', entityId: req.admin.id });
    }
    res.json({ ok: true });
  })
);

router.get(
  '/admin/auth/me',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json({ admin: req.admin });
  })
);

router.post(
  '/admin/auth/change-password',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const schema = z.object({
      currentPassword: z.string().min(1, 'Current password is required.'),
      newPassword: passwordSchema(),
    });
    let body;
    try {
      body = schema.parse(req.body);
    } catch (e) {
      throw zodError(e);
    }
    if (body.currentPassword === body.newPassword) {
      throw badRequest('The new password must be different from the current password.');
    }
    const row = get('SELECT * FROM admins WHERE id = ?', [req.admin.id]);
    if (!row || !verifyPassword(body.currentPassword, row.password_hash)) {
      audit(req, { action: 'admin_password_change_failed', entity: 'admin', entityId: req.admin.id });
      throw unauthorized('Current password is incorrect.');
    }
    run('UPDATE admins SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?', [
      hashPassword(body.newPassword),
      isoNow(),
      req.admin.id,
    ]);
    // Invalidate other sessions for this admin; keep the current one.
    run(
      'UPDATE sessions SET revoked_at = ? WHERE actor_type = ? AND actor_id = ? AND revoked_at IS NULL AND token_hash != ?',
      [isoNow(), 'admin', req.admin.id, req.adminSession.token_hash]
    );
    audit(req, { action: 'admin_password_changed', entity: 'admin', entityId: req.admin.id });
    res.json({ ok: true, mustChangePassword: false });
  })
);

// ---------------------------------------------------------------- client ---

router.post(
  '/client/auth/login',
  authLimiter(),
  asyncHandler(async (req, res) => {
    const schema = z.object({
      fullName: z.string().min(2, 'Enter your full name as registered.').transform((v) => v.trim()),
      accessCode: z.string().min(4, 'Enter the access code issued to you.').transform((v) => v.trim().toUpperCase()),
    });
    let body;
    try {
      body = schema.parse(req.body);
    } catch (e) {
      throw zodError(e);
    }

    const client = get('SELECT * FROM clients WHERE full_name = ? COLLATE NOCASE', [body.fullName]);
    // Deliberately generic message: do not reveal whether the name exists.
    if (!client || !verifyAccessCode(body.accessCode, client.access_code_hash)) {
      audit(req, {
        actor: { type: 'system', id: null },
        action: 'client_login_failed',
        entity: 'client',
        entityId: client ? client.id : null,
        details: { fullName: body.fullName },
      });
      throw unauthorized('Invalid full name or access code.');
    }
    if (client.status !== 'active') {
      throw forbidden('Your account has been suspended. Please contact support.');
    }

    const session = createSession({
      actorType: 'client',
      actorId: client.id,
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
    });
    setSessionCookie(res, CLIENT_COOKIE, session.token, session.expiresAt);
    audit(req, { action: 'client_login', entity: 'client', entityId: client.id });

    res.json({
      client: {
        id: client.id,
        clientCode: client.client_code,
        fullName: client.full_name,
        email: client.email,
        phone: client.phone,
      },
    });
  })
);

router.post(
  '/client/auth/logout',
  asyncHandler(async (req, res) => {
    revokeSession(req.cookies?.[CLIENT_COOKIE]);
    clearSessionCookie(res, CLIENT_COOKIE);
    res.json({ ok: true });
  })
);

router.get(
  '/client/auth/me',
  requireClient,
  asyncHandler(async (req, res) => {
    const row = get('SELECT * FROM clients WHERE id = ?', [req.portalClient.id]);
    res.json({
      client: {
        id: row.id,
        clientCode: row.client_code,
        fullName: row.full_name,
        email: row.email,
        phone: row.phone,
      },
    });
  })
);

/**
 * Client self-service access-code reset request. Always returns a generic
 * success message so the endpoint cannot be used to enumerate clients. The
 * request is turned into an admin notification; an administrator resets the
 * access code from the Admin Portal.
 */
router.post(
  '/client/auth/access-reset-request',
  authLimiter(),
  asyncHandler(async (req, res) => {
    const schema = z.object({
      fullName: z.string().min(2).transform((v) => v.trim()),
      email: z.string().email().transform((v) => v.trim().toLowerCase()),
    });
    let body;
    try {
      body = schema.parse(req.body);
    } catch (e) {
      throw zodError(e);
    }
    const client = get('SELECT * FROM clients WHERE full_name = ? COLLATE NOCASE AND email = ? COLLATE NOCASE', [
      body.fullName,
      body.email,
    ]);
    if (client) {
      audit(req, { action: 'client_access_reset_requested', entity: 'client', entityId: client.id });
      await notifyFromTemplate('access_reset_requested', {
        vars: {
          client_name: client.full_name,
          client_code: client.client_code,
          email: client.email,
        },
        fallbackSubject: `Access-code reset requested — ${client.client_code}`,
        fallbackBody: `Client ${client.full_name} (${client.client_code}, ${client.email}) requested an access-code reset.`,
      });
    }
    res.json({
      ok: true,
      message: 'If the details match an account, our team will contact you with a new access code.',
    });
  })
);

// Referenced so tree-shaking keeps parseJson usage explicit for future auth payloads.
void parseJson;
void revokeAllSessionsForActor;

export default router;
