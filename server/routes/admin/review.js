import { Router } from 'express';
import { z } from 'zod';
import { run, get, all, tx, isoNow, parseJson } from '../../db.js';
import { asyncHandler, badRequest, notFound, zodError } from '../../lib/http.js';
import { audit } from '../../lib/audit.js';
import { requireAdmin } from '../../middleware/auth.js';
import { notifyFromTemplate } from '../../lib/notify.js';
import { getSetting, getCurrency } from '../../lib/settings.js';
import { formatMoney } from '../../lib/money.js';

const router = Router();
router.use(requireAdmin);

function serializeConfirmation(row) {
  const currency = getCurrency(row.currency);
  return {
    id: row.id,
    paymentReferenceId: row.payment_reference_id,
    refCode: row.ref_code,
    invoiceId: row.invoice_id,
    invoiceRef: row.invoice_ref,
    clientId: row.client_id,
    clientName: row.client_name,
    clientCode: row.client_code,
    method: row.method,
    sentDate: row.sent_date,
    amountSentCents: row.amount_sent_cents,
    amountSentFormatted: formatMoney(row.amount_sent_cents, row.currency),
    currency: row.currency,
    currencySymbol: currency?.symbol || row.currency,
    senderName: row.sender_name,
    transferReference: row.transfer_reference,
    transactionId: row.transaction_id,
    note: row.note,
    status: row.status,
    reviewerId: row.reviewer_id,
    reviewerEmail: row.reviewer_email,
    reviewedAt: row.reviewed_at,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const LIST_SQL = `
  SELECT pc.*, pr.ref_code, i.invoice_ref, c.full_name AS client_name, c.client_code,
         a.email AS reviewer_email
    FROM payment_confirmations pc
    JOIN payment_references pr ON pr.id = pc.payment_reference_id
    JOIN invoices i ON i.id = pc.invoice_id
    JOIN clients c ON c.id = pc.client_id
    LEFT JOIN admins a ON a.id = pc.reviewer_id`;

function listConfirmations({ q, status, method, currency, page, pageSize }) {
  const where = [];
  const params = [];
  if (q) {
    where.push('(pr.ref_code LIKE ? OR i.invoice_ref LIKE ? OR c.full_name LIKE ? OR c.client_code LIKE ? OR pc.transfer_reference LIKE ? OR pc.transaction_id LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like);
  }
  if (status) {
    where.push('pc.status = ?');
    params.push(status);
  }
  if (method) {
    where.push('pc.method = ?');
    params.push(method);
  }
  if (currency) {
    where.push('pc.currency = ?');
    params.push(String(currency).toUpperCase());
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = get(`SELECT COUNT(*) AS n FROM payment_confirmations pc
    JOIN payment_references pr ON pr.id = pc.payment_reference_id
    JOIN invoices i ON i.id = pc.invoice_id
    JOIN clients c ON c.id = pc.client_id ${whereSql}`, params).n;
  const rows = all(
    `${LIST_SQL} ${whereSql} ORDER BY pc.created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );
  return { total, confirmations: rows.map(serializeConfirmation) };
}

router.get(
  '/transactions',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Number(req.query.pageSize) || 20);
    res.json({
      ...listConfirmations({
        q: req.query.q ? String(req.query.q).trim() : '',
        status: req.query.status ? String(req.query.status) : '',
        method: req.query.method ? String(req.query.method) : '',
        currency: req.query.currency ? String(req.query.currency) : '',
        page,
        pageSize,
      }),
      page,
      pageSize,
    });
  })
);

router.get(
  '/transactions/:id',
  asyncHandler(async (req, res) => {
    const row = get(`${LIST_SQL} WHERE pc.id = ?`, [req.params.id]);
    if (!row) throw notFound('Transaction not found.');
    const invoice = get('SELECT * FROM invoices WHERE id = ?', [row.invoice_id]);
    const reference = get('SELECT * FROM payment_references WHERE id = ?', [row.payment_reference_id]);
    const receipts = all('SELECT * FROM receipts WHERE confirmation_id = ? ORDER BY uploaded_at', [row.id]);
    const history = all(
      'SELECT * FROM confirmation_status_history WHERE confirmation_id = ? ORDER BY created_at, id',
      [row.id]
    );
    const notes = all(
      'SELECT an.*, a.email AS admin_email FROM admin_notes an LEFT JOIN admins a ON a.id = an.admin_id WHERE an.confirmation_id = ? ORDER BY an.created_at DESC',
      [row.id]
    );
    res.json({
      confirmation: serializeConfirmation(row),
      invoice: invoice
        ? {
            id: invoice.id,
            invoiceRef: invoice.invoice_ref,
            description: invoice.description,
            amountCents: invoice.amount_cents,
            amountFormatted: formatMoney(invoice.amount_cents, invoice.currency),
            currency: invoice.currency,
            status: invoice.status,
            dueDate: invoice.due_date,
          }
        : null,
      reference: reference
        ? {
            id: reference.id,
            refCode: reference.ref_code,
            method: reference.method,
            currency: reference.currency,
            amountCents: reference.amount_cents,
            amountFormatted: formatMoney(reference.amount_cents, reference.currency),
            status: reference.status,
            // Snapshot of the instructions shown when the reference was issued.
            instructionsSnapshot: parseJson(reference.instructions_snapshot, null),
            createdAt: reference.created_at,
          }
        : null,
      receipts: receipts.map((r) => ({
        id: r.id,
        originalFilename: r.original_filename,
        mimeType: r.mime_type,
        sizeBytes: r.size_bytes,
        sha256: r.sha256,
        uploadedAt: r.uploaded_at,
      })),
      history,
      notes,
    });
  })
);

/**
 * Review action: under_review | verified | rejected | info_requested.
 * Verification is a privileged, audited action performed only by an
 * authorized administrator after actual verification of funds.
 */
router.post(
  '/transactions/:id/review',
  asyncHandler(async (req, res) => {
    const row = get(`${LIST_SQL} WHERE pc.id = ?`, [req.params.id]);
    if (!row) throw notFound('Transaction not found.');
    const schema = z.object({
      action: z.enum(['under_review', 'verified', 'rejected', 'info_requested']),
      reason: z.string().max(2000).optional().or(z.literal('')),
      note: z.string().max(4000).optional().or(z.literal('')),
    });
    let body;
    try {
      body = schema.parse(req.body);
    } catch (e) {
      throw zodError(e);
    }
    const { action, reason, note } = body;
    if (!['submitted', 'under_review', 'info_requested', 'rejected'].includes(row.status)) {
      throw badRequest(`Cannot review a transaction with status "${row.status}".`);
    }
    if ((action === 'rejected' || action === 'info_requested') && (!reason || !reason.trim())) {
      throw badRequest(`A reason is required when marking a submission as ${action === 'rejected' ? 'rejected' : 'information requested'}.`);
    }

    tx(() => {
      const now = isoNow();
      // Re-read inside the write transaction so the status check is atomic
      // with the update — two concurrent reviews cannot both apply.
      const current = get('SELECT status FROM payment_confirmations WHERE id = ?', [row.id]);
      if (!current || !['submitted', 'under_review', 'info_requested', 'rejected'].includes(current.status)) {
        throw badRequest(`Cannot review a transaction with status "${current ? current.status : 'unknown'}".`);
      }
      if (action === 'under_review') {
        run(
          `UPDATE payment_confirmations SET status = 'under_review', reviewer_id = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`,
          [req.admin.id, now, now, row.id]
        );
        run(`UPDATE payment_references SET status = 'under_review', updated_at = ? WHERE id = ?`, [now, row.payment_reference_id]);
        run(`UPDATE invoices SET status = 'under_review', updated_at = ? WHERE id = ?`, [now, row.invoice_id]);
        run(
          'INSERT INTO confirmation_status_history (confirmation_id, status, note, actor_type, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [row.id, 'under_review', note || null, 'admin', req.admin.id, now]
        );
      } else if (action === 'verified') {
        // Only an authorized administrator may mark a manually reported
        // transfer as verified, and the reviewer + timestamp are recorded.
        run(
          `UPDATE payment_confirmations SET status = 'verified', reviewer_id = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`,
          [req.admin.id, now, now, row.id]
        );
        run(`UPDATE payment_references SET status = 'verified', updated_at = ? WHERE id = ?`, [now, row.payment_reference_id]);
        const invoice = get('SELECT * FROM invoices WHERE id = ?', [row.invoice_id]);
        const newInvoiceStatus =
          row.amount_sent_cents >= invoice.amount_cents ? 'paid' : 'partially_paid';
        run('UPDATE invoices SET status = ?, updated_at = ? WHERE id = ?', [newInvoiceStatus, now, invoice.id]);
        run(
          'INSERT INTO confirmation_status_history (confirmation_id, status, note, actor_type, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [row.id, 'verified', note || null, 'admin', req.admin.id, now]
        );
      } else if (action === 'rejected') {
        run(
          `UPDATE payment_confirmations SET status = 'rejected', rejection_reason = ?, reviewer_id = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`,
          [reason.trim(), req.admin.id, now, now, row.id]
        );
        run(`UPDATE payment_references SET status = 'rejected', updated_at = ? WHERE id = ?`, [now, row.payment_reference_id]);
        run(`UPDATE invoices SET status = 'rejected', updated_at = ? WHERE id = ?`, [now, row.invoice_id]);
        run(
          'INSERT INTO confirmation_status_history (confirmation_id, status, note, actor_type, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [row.id, 'rejected', reason.trim(), 'admin', req.admin.id, now]
        );
      } else {
        // info_requested
        run(
          `UPDATE payment_confirmations SET status = 'info_requested', reviewer_id = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`,
          [req.admin.id, now, now, row.id]
        );
        run(`UPDATE payment_references SET status = 'info_requested', updated_at = ? WHERE id = ?`, [now, row.payment_reference_id]);
        run(`UPDATE invoices SET status = 'awaiting_payment', updated_at = ? WHERE id = ?`, [now, row.invoice_id]);
        run(
          'INSERT INTO confirmation_status_history (confirmation_id, status, note, actor_type, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [row.id, 'info_requested', reason.trim(), 'admin', req.admin.id, now]
        );
      }
      if (note && note.trim()) {
        run('INSERT INTO admin_notes (confirmation_id, note, admin_id, created_at) VALUES (?, ?, ?, ?)', [
          row.id,
          note.trim(),
          req.admin.id,
          now,
        ]);
      }
    });

    audit(req, {
      action: action === 'verified' ? 'payment_verified' : action === 'rejected' ? 'payment_rejected' : action === 'info_requested' ? 'payment_info_requested' : 'payment_under_review',
      entity: 'payment_confirmation',
      entityId: row.id,
      details: { refCode: row.ref_code, invoiceRef: row.invoice_ref, reviewer: req.admin.email, reason: reason || undefined },
    });

    // Notify the client about outcomes (email only if SMTP is configured).
    const client = get('SELECT * FROM clients WHERE id = ?', [row.client_id]);
    const vars = {
      client_name: client?.full_name,
      payment_ref: row.ref_code,
      invoice_ref: row.invoice_ref,
      amount: formatMoney(row.amount_sent_cents, row.currency),
      currency: row.currency,
      reason: reason || '',
    };
    if (client?.email) {
      if (action === 'verified' && getSetting('notify_on_payment_approved')) {
        await notifyFromTemplate('payment_approved', { recipient: client.email, vars, fallbackSubject: `Payment verified — ${row.ref_code}`, fallbackBody: `Your payment of ${vars.amount} ${vars.currency} for invoice ${row.invoice_ref} has been verified.` });
      } else if (action === 'rejected' && getSetting('notify_on_payment_rejected')) {
        await notifyFromTemplate('payment_rejected', { recipient: client.email, vars, fallbackSubject: `Payment submission needs attention — ${row.ref_code}`, fallbackBody: `Your payment submission for invoice ${row.invoice_ref} could not be verified. Reason: ${reason}.` });
      } else if (action === 'info_requested') {
        await notifyFromTemplate('info_requested', { recipient: client.email, vars, fallbackSubject: `Additional information required — ${row.ref_code}`, fallbackBody: `We need additional information for your payment submission ${row.ref_code}: ${reason}` });
      }
    }

    res.json({ ok: true, status: action });
  })
);

router.post(
  '/transactions/:id/notes',
  asyncHandler(async (req, res) => {
    const row = get('SELECT * FROM payment_confirmations WHERE id = ?', [req.params.id]);
    if (!row) throw notFound('Transaction not found.');
    const schema = z.object({ note: z.string().min(1).max(4000) });
    let body;
    try {
      body = schema.parse(req.body);
    } catch (e) {
      throw zodError(e);
    }
    run('INSERT INTO admin_notes (confirmation_id, note, admin_id, created_at) VALUES (?, ?, ?, ?)', [
      row.id,
      body.note.trim(),
      req.admin.id,
      isoNow(),
    ]);
    audit(req, { action: 'transaction_note_added', entity: 'payment_confirmation', entityId: row.id });
    res.status(201).json({ ok: true });
  })
);

export default router;
