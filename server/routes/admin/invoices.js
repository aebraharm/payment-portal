import { Router } from 'express';
import { z } from 'zod';
import { run, get, all, tx, isoNow } from '../../db.js';
import { generateInvoiceRef } from '../../lib/refs.js';
import { asyncHandler, badRequest, notFound, conflict, zodError } from '../../lib/http.js';
import { audit } from '../../lib/audit.js';
import { requireAdmin } from '../../middleware/auth.js';
import { notifyFromTemplate } from '../../lib/notify.js';
import { getSetting, getCurrency } from '../../lib/settings.js';
import { formatMoney, parseAmountToCents } from '../../lib/money.js';

const router = Router();
router.use(requireAdmin);

export function serializeInvoice(row) {
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
    lineItems: all(
      'SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY sort_order, id',
      [row.id]
    ).map((li) => ({
      id: li.id,
      description: li.description,
      quantity: li.quantity,
      unitAmountCents: li.unit_amount_cents,
      totalCents: li.quantity * li.unit_amount_cents,
    })),
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const lineItemSchema = z.object({
  description: z.string().min(1, 'Line item description is required.'),
  quantity: z.number().int().positive().max(1000).default(1),
  unitAmount: z.string().min(1, 'Unit amount is required.'),
});

const createSchema = z.object({
  clientId: z.number().int().positive(),
  description: z.string().min(2, 'Description is required.').max(500),
  amount: z.string().optional(), // decimal string; ignored when lineItems provided
  currency: z.string().length(3),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Issue date must be YYYY-MM-DD.'),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Due date must be YYYY-MM-DD.'),
  allowPartial: z.boolean().optional().default(false),
  notes: z.string().max(4000).optional().or(z.literal('')),
  lineItems: z.array(lineItemSchema).optional(),
});

function computeAmountCents(body) {
  // The server calculates and validates amounts — never trust the browser.
  if (body.lineItems && body.lineItems.length > 0) {
    let total = 0;
    for (const li of body.lineItems) {
      const unit = parseAmountToCents(li.unitAmount);
      if (unit === null || unit < 0) {
        throw badRequest(`Line item "${li.description}" has an invalid unit amount.`);
      }
      total += unit * li.quantity;
    }
    return total;
  }
  const cents = parseAmountToCents(body.amount || '');
  if (cents === null || cents <= 0) {
    throw badRequest('A valid, positive amount is required (e.g. 1500.00).');
  }
  return cents;
}

router.get(
  '/invoices',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Number(req.query.pageSize) || 20);
    const where = [];
    const params = [];
    if (req.query.q) {
      where.push('(i.invoice_ref LIKE ? OR i.description LIKE ? OR c.full_name LIKE ?)');
      const like = `%${String(req.query.q).trim()}%`;
      params.push(like, like, like);
    }
    if (req.query.status) {
      where.push('i.status = ?');
      params.push(String(req.query.status));
    }
    if (req.query.clientId) {
      where.push('i.client_id = ?');
      params.push(Number(req.query.clientId));
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = get(
      `SELECT COUNT(*) AS n FROM invoices i LEFT JOIN clients c ON c.id = i.client_id ${whereSql}`,
      params
    ).n;
    const rows = all(
      `SELECT i.*, c.full_name AS client_name, c.client_code
         FROM invoices i LEFT JOIN clients c ON c.id = i.client_id ${whereSql}
        ORDER BY i.created_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    );
    res.json({
      total,
      page,
      pageSize,
      invoices: rows.map((r) => ({ ...serializeInvoice(r), clientName: r.client_name, clientCode: r.client_code })),
    });
  })
);

router.post(
  '/invoices',
  asyncHandler(async (req, res) => {
    let body;
    try {
      body = createSchema.parse(req.body);
    } catch (e) {
      throw zodError(e);
    }
    if (new Date(body.dueDate) < new Date(body.issueDate)) {
      throw badRequest('Due date cannot be before the issue date.');
    }
    const client = get('SELECT * FROM clients WHERE id = ?', [body.clientId]);
    if (!client) throw notFound('Client not found.');
    if (client.status !== 'active') throw badRequest('Cannot invoice a suspended client.');
    const currency = getCurrency(body.currency.toUpperCase());
    if (!currency || !currency.enabled) {
      throw badRequest(`Currency ${body.currency.toUpperCase()} is not enabled. Enable it in Payment settings first.`);
    }
    const amountCents = computeAmountCents({ ...body, currency: body.currency.toUpperCase() });
    const prefix = getSetting('invoice_ref_prefix') || 'INV';
    const invoiceRef = generateInvoiceRef(prefix);
    const now = isoNow();

    const invoiceId = tx(() => {
      const inserted = run(
        `INSERT INTO invoices (invoice_ref, client_id, description, amount_cents, currency, issue_date, due_date, status, allow_partial, notes, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?, ?, ?, ?)`,
        [
          invoiceRef,
          client.id,
          body.description.trim(),
          amountCents,
          currency.code,
          body.issueDate,
          body.dueDate,
          body.allowPartial ? 1 : 0,
          body.notes || null,
          req.admin.id,
          now,
          now,
        ]
      );
      const id = inserted.lastInsertRowid;
      (body.lineItems || []).forEach((li, idx) => {
        const unit = parseAmountToCents(li.unitAmount);
        run(
          'INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_amount_cents, sort_order) VALUES (?, ?, ?, ?, ?)',
          [id, li.description, li.quantity, unit, idx]
        );
      });
      return id;
    });

    audit(req, {
      action: 'invoice_created',
      entity: 'invoice',
      entityId: invoiceId,
      details: { invoiceRef, amountCents, currency: currency.code, clientId: client.id },
    });
    if (client.email) {
      await notifyFromTemplate('invoice_created', {
        recipient: client.email,
        vars: {
          client_name: client.full_name,
          invoice_ref: invoiceRef,
          amount: formatMoney(amountCents, currency.code),
          currency: currency.code,
          due_date: body.dueDate,
        },
        fallbackSubject: `New invoice ${invoiceRef}`,
        fallbackBody: `Hello ${client.full_name}, a new invoice ${invoiceRef} for ${formatMoney(amountCents, currency.code)} has been issued. Due date: ${body.dueDate}.`,
      });
    }
    res.status(201).json({ invoice: serializeInvoice(get('SELECT * FROM invoices WHERE id = ?', [invoiceId])) });
  })
);

router.get(
  '/invoices/:id',
  asyncHandler(async (req, res) => {
    const row = get(
      'SELECT i.*, c.full_name AS client_name, c.client_code FROM invoices i LEFT JOIN clients c ON c.id = i.client_id WHERE i.id = ?',
      [req.params.id]
    );
    if (!row) throw notFound('Invoice not found.');
    res.json({ invoice: { ...serializeInvoice(row), clientName: row.client_name, clientCode: row.client_code } });
  })
);

router.put(
  '/invoices/:id',
  asyncHandler(async (req, res) => {
    const row = get('SELECT * FROM invoices WHERE id = ?', [req.params.id]);
    if (!row) throw notFound('Invoice not found.');
    if (['paid', 'partially_paid', 'cancelled', 'refunded'].includes(row.status)) {
      throw conflict(`Cannot edit an invoice with status "${row.status}".`);
    }
    const schema = z.object({
      description: z.string().min(2).max(500).optional(),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      allowPartial: z.boolean().optional(),
      notes: z.string().max(4000).optional().or(z.literal('')).nullable(),
    });
    let body;
    try {
      body = schema.parse(req.body);
    } catch (e) {
      throw zodError(e);
    }
    if (body.dueDate && new Date(body.dueDate) < new Date(row.issue_date)) {
      throw badRequest('Due date cannot be before the issue date.');
    }
    run(
      `UPDATE invoices SET description = ?, due_date = ?, allow_partial = ?, notes = ?, updated_at = ? WHERE id = ?`,
      [
        body.description ?? row.description,
        body.dueDate ?? row.due_date,
        body.allowPartial !== undefined ? (body.allowPartial ? 1 : 0) : row.allow_partial,
        body.notes === undefined ? row.notes : body.notes || null,
        isoNow(),
        row.id,
      ]
    );
    audit(req, { action: 'invoice_updated', entity: 'invoice', entityId: row.id, details: { invoiceRef: row.invoice_ref } });
    res.json({ invoice: serializeInvoice(get('SELECT * FROM invoices WHERE id = ?', [row.id])) });
  })
);

/** Cancel an invoice. Requires a reason and leaves a full audit trail. */
router.post(
  '/invoices/:id/cancel',
  asyncHandler(async (req, res) => {
    const row = get('SELECT * FROM invoices WHERE id = ?', [req.params.id]);
    if (!row) throw notFound('Invoice not found.');
    if (row.status === 'cancelled') throw conflict('Invoice is already cancelled.');
    if (['paid', 'partially_paid', 'refunded'].includes(row.status)) {
      throw conflict(`Cannot cancel an invoice with status "${row.status}".`);
    }
    const schema = z.object({ reason: z.string().min(3, 'A cancellation reason is required.').max(1000) });
    let body;
    try {
      body = schema.parse(req.body);
    } catch (e) {
      throw zodError(e);
    }
    run(
      `UPDATE invoices SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?`,
      [isoNow(), body.reason, isoNow(), row.id]
    );
    audit(req, {
      action: 'invoice_cancelled',
      entity: 'invoice',
      entityId: row.id,
      details: { invoiceRef: row.invoice_ref, reason: body.reason },
    });
    res.json({ invoice: serializeInvoice(get('SELECT * FROM invoices WHERE id = ?', [row.id])) });
  })
);

export default router;
