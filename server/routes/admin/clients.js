import { Router } from 'express';
import { z } from 'zod';
import { run, get, all, isoNow } from '../../db.js';
import { generateClientCode } from '../../lib/refs.js';
import { generateAccessCode, hashAccessCode } from '../../lib/tokens.js';
import { asyncHandler, badRequest, notFound, zodError } from '../../lib/http.js';
import { audit } from '../../lib/audit.js';
import { requireAdmin } from '../../middleware/auth.js';
import { notifyFromTemplate } from '../../lib/notify.js';
import { getCurrency } from '../../lib/settings.js';
import { formatMoney } from '../../lib/money.js';

const router = Router();
router.use(requireAdmin);

function clientProfile(row) {
  return {
    id: row.id,
    clientCode: row.client_code,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    status: row.status,
    accessCodeHint: row.access_code_hint,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listClients({ q, status, page, pageSize }) {
  const where = [];
  const params = [];
  if (q) {
    where.push('(c.full_name LIKE ? OR c.client_code LIKE ? OR c.email LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  if (status) {
    where.push('c.status = ?');
    params.push(status);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = get(`SELECT COUNT(*) AS n FROM clients c ${whereSql}`, params).n;
  const rows = all(
    `SELECT c.*,
       (SELECT COUNT(*) FROM invoices i WHERE i.client_id = c.id) AS invoice_count,
       (SELECT COUNT(*) FROM invoices i WHERE i.client_id = c.id AND i.status IN ('unpaid','awaiting_payment','confirmation_submitted','under_review','rejected')) AS open_invoice_count
     FROM clients c ${whereSql} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );
  return { total, clients: rows.map(clientProfile) };
}

router.get(
  '/clients',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Number(req.query.pageSize) || 20);
    res.json({
      ...listClients({
        q: req.query.q ? String(req.query.q).trim() : '',
        status: req.query.status ? String(req.query.status) : '',
        page,
        pageSize,
      }),
      page,
      pageSize,
    });
  })
);

router.post(
  '/clients',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      fullName: z.string().min(2, 'Full name is required.').transform((v) => v.trim()),
      email: z.string().email().transform((v) => v.trim().toLowerCase()).optional().or(z.literal('')),
      phone: z.string().max(40).optional().or(z.literal('')),
      notes: z.string().max(4000).optional().or(z.literal('')),
    });
    let body;
    try {
      body = schema.parse(req.body);
    } catch (e) {
      throw zodError(e);
    }
    const existing = get('SELECT id FROM clients WHERE full_name = ? COLLATE NOCASE', [body.fullName]);
    if (existing) {
      throw badRequest('A client with this full name already exists. Client full names are the login identifier.');
    }

    const accessCode = generateAccessCode(8);
    const now = isoNow();
    const clientCode = generateClientCode();
    const inserted = run(
      `INSERT INTO clients (client_code, full_name, email, phone, status, access_code_hash, access_code_hint, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
      [
        clientCode,
        body.fullName,
        body.email || null,
        body.phone || null,
        hashAccessCode(accessCode),
        accessCode.slice(-2),
        body.notes || null,
        now,
        now,
      ]
    );
    const client = get('SELECT * FROM clients WHERE id = ?', [inserted.lastInsertRowid]);
    audit(req, {
      action: 'client_created',
      entity: 'client',
      entityId: client.id,
      details: { clientCode: client.client_code, fullName: client.full_name },
    });
    if (body.email) {
      await notifyFromTemplate('client_created', {
        recipient: body.email,
        vars: { client_name: client.full_name, client_code: client.client_code },
        fallbackSubject: 'Your payment portal access',
        fallbackBody: `Hello ${client.full_name}, your payment portal account has been created. Client reference: ${client.client_code}.`,
      });
    }
    res.status(201).json({
      client: clientProfile(client),
      // The access code is shown to the administrator exactly once. It is
      // never stored in plaintext and cannot be retrieved again.
      accessCode,
    });
  })
);

function getClientOr404(id) {
  const client = get('SELECT * FROM clients WHERE id = ?', [id]);
  if (!client) throw notFound('Client not found.');
  return client;
}

router.get(
  '/clients/:id',
  asyncHandler(async (req, res) => {
    const client = getClientOr404(req.params.id);
    const invoices = all(
      `SELECT * FROM invoices WHERE client_id = ? ORDER BY created_at DESC`,
      [client.id]
    ).map(serializeInvoice);
    const confirmations = all(
      `SELECT pc.*, pr.ref_code
         FROM payment_confirmations pc JOIN payment_references pr ON pr.id = pc.payment_reference_id
        WHERE pc.client_id = ? ORDER BY pc.created_at DESC LIMIT 50`,
      [client.id]
    ).map((r) => ({
      id: r.id,
      paymentReferenceId: r.payment_reference_id,
      refCode: r.ref_code,
      invoiceId: r.invoice_id,
      method: r.method,
      sentDate: r.sent_date,
      amountSentCents: r.amount_sent_cents,
      amountSentFormatted: formatMoney(r.amount_sent_cents, r.currency),
      currency: r.currency,
      status: r.status,
      rejectionReason: r.rejection_reason,
      reviewedAt: r.reviewed_at,
      createdAt: r.created_at,
    }));
    const notes = all(
      `SELECT an.*, a.email AS admin_email FROM admin_notes an LEFT JOIN admins a ON a.id = an.admin_id
        WHERE an.client_id = ? ORDER BY an.created_at DESC`,
      [client.id]
    );
    const outstanding = all(
      `SELECT currency, SUM(amount_cents) AS cents FROM invoices
        WHERE client_id = ? AND status IN ('unpaid','awaiting_payment','confirmation_submitted','under_review','rejected')
        GROUP BY currency`,
      [client.id]
    ).map((r) => ({ currency: r.currency, amountCents: r.cents, amountFormatted: formatMoney(r.cents, r.currency) }));
    res.json({ client: clientProfile(client), invoices, confirmations, notes, outstanding });
  })
);

router.put(
  '/clients/:id',
  asyncHandler(async (req, res) => {
    const client = getClientOr404(req.params.id);
    const schema = z.object({
      fullName: z.string().min(2).transform((v) => v.trim()).optional(),
      email: z.string().email().transform((v) => v.trim().toLowerCase()).optional().or(z.literal('')).nullable(),
      phone: z.string().max(40).optional().or(z.literal('')).nullable(),
      status: z.enum(['active', 'suspended']).optional(),
      notes: z.string().max(4000).optional().or(z.literal('')).nullable(),
    });
    let body;
    try {
      body = schema.parse(req.body);
    } catch (e) {
      throw zodError(e);
    }
    if (body.fullName && body.fullName.toLowerCase() !== client.full_name.toLowerCase()) {
      const dup = get('SELECT id FROM clients WHERE full_name = ? COLLATE NOCASE AND id != ?', [
        body.fullName,
        client.id,
      ]);
      if (dup) throw badRequest('A client with this full name already exists.');
    }
    const nextStatus = body.status || client.status;
    run(
      `UPDATE clients SET full_name = ?, email = ?, phone = ?, status = ?, notes = ?, updated_at = ? WHERE id = ?`,
      [
        body.fullName ?? client.full_name,
        body.email === undefined ? client.email : body.email || null,
        body.phone === undefined ? client.phone : body.phone || null,
        nextStatus,
        body.notes === undefined ? client.notes : body.notes || null,
        isoNow(),
        client.id,
      ]
    );
    if (nextStatus === 'suspended' && client.status !== 'suspended') {
      run(
        'UPDATE sessions SET revoked_at = ? WHERE actor_type = ? AND actor_id = ? AND revoked_at IS NULL',
        [isoNow(), 'client', client.id]
      );
    }
    audit(req, {
      action: body.status && body.status !== client.status ? 'client_status_changed' : 'client_updated',
      entity: 'client',
      entityId: client.id,
      details: { status: nextStatus },
    });
    res.json({ client: clientProfile(get('SELECT * FROM clients WHERE id = ?', [client.id])) });
  })
);

/** Generate a fresh access code. Returned once; the old code stops working. */
router.post(
  '/clients/:id/access-code/reset',
  asyncHandler(async (req, res) => {
    const client = getClientOr404(req.params.id);
    const accessCode = generateAccessCode(8);
    run('UPDATE clients SET access_code_hash = ?, access_code_hint = ?, updated_at = ? WHERE id = ?', [
      hashAccessCode(accessCode),
      accessCode.slice(-2),
      isoNow(),
      client.id,
    ]);
    run(
      'UPDATE sessions SET revoked_at = ? WHERE actor_type = ? AND actor_id = ? AND revoked_at IS NULL',
      [isoNow(), 'client', client.id]
    );
    audit(req, { action: 'client_access_code_reset', entity: 'client', entityId: client.id });
    res.json({ clientId: client.id, accessCode, accessCodeHint: accessCode.slice(-2) });
  })
);

router.post(
  '/clients/:id/notes',
  asyncHandler(async (req, res) => {
    const client = getClientOr404(req.params.id);
    const schema = z.object({ note: z.string().min(1, 'Note is required.').max(4000) });
    let body;
    try {
      body = schema.parse(req.body);
    } catch (e) {
      throw zodError(e);
    }
    run('INSERT INTO admin_notes (client_id, note, admin_id, created_at) VALUES (?, ?, ?, ?)', [
      client.id,
      body.note,
      req.admin.id,
      isoNow(),
    ]);
    audit(req, { action: 'client_note_added', entity: 'client', entityId: client.id });
    res.status(201).json({ ok: true });
  })
);

router.get(
  '/clients/:id/transactions',
  asyncHandler(async (req, res) => {
    const client = getClientOr404(req.params.id);
    const rows = all(
      `SELECT pr.ref_code, pr.method, pr.currency, pr.amount_cents, pr.status AS reference_status,
              pr.created_at AS reference_created_at,
              pc.id AS confirmation_id, pc.status AS confirmation_status, pc.amount_sent_cents,
              pc.sent_date, pc.rejection_reason, pc.reviewed_at, pc.created_at AS confirmation_created_at,
              i.invoice_ref
         FROM payment_references pr
         JOIN invoices i ON i.id = pr.invoice_id
         LEFT JOIN payment_confirmations pc ON pc.payment_reference_id = pr.id
        WHERE pr.client_id = ?
        ORDER BY pr.created_at DESC`,
      [client.id]
    );
    res.json({ transactions: rows });
  })
);

function serializeInvoice(row) {
  const currency = getCurrency(row.currency);
  return {
    id: row.id,
    invoiceRef: row.invoice_ref,
    clientId: row.client_id,
    description: row.description,
    amountCents: row.amount_cents,
    currency: row.currency,
    currencySymbol: currency?.symbol || row.currency,
    amountFormatted: formatMoney(row.amount_cents, row.currency),
    issueDate: row.issue_date,
    dueDate: row.due_date,
    status: row.status,
    allowPartial: !!row.allow_partial,
    notes: row.notes,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}


export default router;
