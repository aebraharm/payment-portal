import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { run, get, all, isoNow } from '../../db.js';
import { asyncHandler, badRequest, notFound, zodError } from '../../lib/http.js';
import { audit } from '../../lib/audit.js';
import { requireAdmin, requireRole } from '../../middleware/auth.js';
import { hashPassword, revokeSessionById } from '../../lib/tokens.js';

const router = Router();
router.use(requireAdmin);
const requireSuperadmin = requireRole('superadmin');

// ------------------------------------------------------------- audit logs --

router.get(
  '/audit-logs',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Number(req.query.pageSize) || 50);
    const where = [];
    const params = [];
    if (req.query.action) {
      where.push('action = ?');
      params.push(String(req.query.action));
    }
    if (req.query.actorType) {
      where.push('actor_type = ?');
      params.push(String(req.query.actorType));
    }
    if (req.query.q) {
      where.push('(entity LIKE ? OR entity_id LIKE ? OR action LIKE ?)');
      const like = `%${String(req.query.q).trim()}%`;
      params.push(like, like, like);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (await get(`SELECT COUNT(*) AS n FROM audit_logs ${whereSql}`, params)).n;
    const rows = await all(
      `SELECT * FROM audit_logs ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    );
    res.json({ total, page, pageSize, logs: rows });
  })
);

// --------------------------------------------------------------- sessions --

router.get(
  '/sessions',
  asyncHandler(async (_req, res) => {
    const rows = await all(
      `SELECT s.id, s.actor_type, s.actor_id, s.expires_at, s.created_at, s.ip, s.user_agent,
              CASE WHEN s.actor_type = 'admin' THEN (SELECT email FROM admins WHERE id = s.actor_id)
                   ELSE (SELECT full_name FROM clients WHERE id = s.actor_id) END AS actor_label
         FROM sessions s
        WHERE s.revoked_at IS NULL AND s.expires_at > ?
        ORDER BY s.created_at DESC`,
      [isoNow()]
    );
    res.json({ sessions: rows });
  })
);

router.post(
  '/sessions/:id/revoke',
  asyncHandler(async (req, res) => {
    const row = await get('SELECT * FROM sessions WHERE id = ?', [req.params.id]);
    if (!row) throw notFound('Session not found.');
    if (row.revoked_at) throw badRequest('Session is already revoked.');
    await revokeSessionById(row.id);
    await audit(req, {
      action: 'session_revoked',
      entity: 'session',
      entityId: row.id,
      details: { actorType: row.actor_type, actorId: row.actor_id },
    });
    res.json({ ok: true });
  })
);

// -------------------------------------------------------- admin accounts --

router.get(
  '/admins',
  requireSuperadmin,
  asyncHandler(async (_req, res) => {
    const rows = await all('SELECT id, email, role, full_name, status, must_change_password, last_login_at, created_at FROM admins ORDER BY id');
    res.json({
      admins: rows.map((r) => ({ ...r, must_change_password: !!r.must_change_password })),
    });
  })
);

router.post(
  '/admins',
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    const schema = z.object({
      email: z.string().email().transform((v) => v.trim().toLowerCase()),
      password: z.string().min(10, 'Password must be at least 10 characters.').max(72),
      role: z.enum(['superadmin', 'admin', 'reviewer']),
      fullName: z.string().max(120).optional().or(z.literal('')),
    });
    let body;
    try {
      body = schema.parse(req.body);
    } catch (e) {
      throw zodError(e);
    }
    const existing = await get('SELECT id FROM admins WHERE email = ?', [body.email]);
    if (existing) throw badRequest('An administrator with this email already exists.');
    const now = isoNow();
    const inserted = await run(
      `INSERT INTO admins (email, password_hash, role, full_name, status, must_change_password, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', 1, ?, ?)`,
      [body.email, hashPassword(body.password), body.role, body.fullName?.trim() || null, now, now]
    );
    await audit(req, { action: 'admin_created', entity: 'admin', entityId: inserted.lastInsertRowid, details: { email: body.email, role: body.role } });
    res.status(201).json({ ok: true, adminId: inserted.lastInsertRowid });
  })
);

router.put(
  '/admins/:id',
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    const row = await get('SELECT * FROM admins WHERE id = ?', [req.params.id]);
    if (!row) throw notFound('Administrator not found.');
    if (Number(req.params.id) === req.admin.id) {
      throw badRequest('Use the account page to change your own password; role/status changes to your own account are not allowed here.');
    }
    const schema = z.object({
      role: z.enum(['superadmin', 'admin', 'reviewer']).optional(),
      status: z.enum(['active', 'disabled']).optional(),
      fullName: z.string().max(120).optional().or(z.literal('')).nullable(),
    });
    let body;
    try {
      body = schema.parse(req.body);
    } catch (e) {
      throw zodError(e);
    }
    await run('UPDATE admins SET role = ?, status = ?, full_name = ?, updated_at = ? WHERE id = ?', [
      body.role ?? row.role,
      body.status ?? row.status,
      body.fullName === undefined ? row.full_name : body.fullName || null,
      isoNow(),
      row.id,
    ]);
    if (body.status === 'disabled') {
      await run('UPDATE sessions SET revoked_at = ? WHERE actor_type = ? AND actor_id = ? AND revoked_at IS NULL', [
        isoNow(),
        'admin',
        row.id,
      ]);
    }
    await audit(req, { action: 'admin_updated', entity: 'admin', entityId: row.id, details: { role: body.role, status: body.status } });
    res.json({ ok: true });
  })
);

/** Issue a temporary password (shown once) and force a change on next login. */
router.post(
  '/admins/:id/password-reset',
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    const row = await get('SELECT * FROM admins WHERE id = ?', [req.params.id]);
    if (!row) throw notFound('Administrator not found.');
    const tempPassword = crypto.randomBytes(9).toString('base64url').slice(0, 14);
    await run('UPDATE admins SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?', [
      hashPassword(tempPassword),
      isoNow(),
      row.id,
    ]);
    await run('UPDATE sessions SET revoked_at = ? WHERE actor_type = ? AND actor_id = ? AND revoked_at IS NULL', [
      isoNow(),
      'admin',
      row.id,
    ]);
    await audit(req, { action: 'admin_password_reset', entity: 'admin', entityId: row.id });
    res.json({ ok: true, temporaryPassword: tempPassword });
  })
);

// ---------------------------------------------------------- notifications --

router.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Number(req.query.pageSize) || 25);
    const status = req.query.status ? String(req.query.status) : '';
    const where = status ? 'WHERE status = ?' : '';
    const params = status ? [status] : [];
    const total = (await get(`SELECT COUNT(*) AS n FROM notifications ${where}`, params)).n;
    const rows = await all(
      `SELECT * FROM notifications ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    );
    res.json({ total, page, pageSize, notifications: rows });
  })
);

export default router;
