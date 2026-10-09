import { Router } from 'express';
import { all } from '../../db.js';
import { asyncHandler } from '../../lib/http.js';
import { audit } from '../../lib/audit.js';
import { requireAdmin } from '../../middleware/auth.js';
import { formatMoney } from '../../lib/money.js';

const router = Router();
router.use(requireAdmin);

function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Authorized CSV export of transaction records. */
router.get(
  '/reports/transactions.csv',
  asyncHandler(async (req, res) => {
    const where = [];
    const params = [];
    if (req.query.status) {
      where.push('pc.status = ?');
      params.push(String(req.query.status));
    }
    if (req.query.currency) {
      where.push('pc.currency = ?');
      params.push(String(req.query.currency).toUpperCase());
    }
    if (req.query.q) {
      where.push('(pr.ref_code LIKE ? OR i.invoice_ref LIKE ? OR c.full_name LIKE ? OR c.client_code LIKE ?)');
      const like = `%${String(req.query.q).trim()}%`;
      params.push(like, like, like, like);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = all(
      `SELECT pc.*, pr.ref_code, i.invoice_ref, c.full_name AS client_name, c.client_code,
              a.email AS reviewer_email
         FROM payment_confirmations pc
         JOIN payment_references pr ON pr.id = pc.payment_reference_id
         JOIN invoices i ON i.id = pc.invoice_id
         JOIN clients c ON c.id = pc.client_id
         LEFT JOIN admins a ON a.id = pc.reviewer_id
        ${whereSql}
        ORDER BY pc.created_at DESC`,
      params
    );
    const header = [
      'payment_ref', 'invoice_ref', 'client_code', 'client_name', 'method', 'currency',
      'amount_sent', 'amount_formatted', 'sent_date', 'sender_name', 'transfer_reference',
      'transaction_id', 'status', 'reviewer', 'reviewed_at', 'rejection_reason', 'submitted_at',
    ];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push(
        [
          r.ref_code,
          r.invoice_ref,
          r.client_code,
          r.client_name,
          r.method,
          r.currency,
          (r.amount_sent_cents / 100).toFixed(2),
          formatMoney(r.amount_sent_cents, r.currency),
          r.sent_date,
          r.sender_name,
          r.transfer_reference,
          r.transaction_id,
          r.status,
          r.reviewer_email,
          r.reviewed_at,
          r.rejection_reason,
          r.created_at,
        ]
          .map(csvEscape)
          .join(',')
      );
    }
    audit(req, { action: 'transactions_report_exported', entity: 'report', details: { rows: rows.length } });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="transactions-report.csv"');
    res.send(lines.join('\n'));
  })
);

export default router;
