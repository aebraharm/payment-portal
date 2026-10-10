import { Router } from 'express';
import { all, get, isoNow } from '../../db.js';
import { asyncHandler } from '../../lib/http.js';
import { requireAdmin } from '../../middleware/auth.js';
import { formatMoney } from '../../lib/money.js';

const router = Router();
router.use(requireAdmin);

function sumByCurrency(rows) {
  const map = new Map();
  for (const r of rows) {
    const cur = r.currency;
    map.set(cur, (map.get(cur) || 0) + Number(r.cents || r.amount_sent_cents || 0));
  }
  return [...map.entries()].map(([currency, cents]) => ({
    currency,
    cents,
    formatted: formatMoney(cents, currency),
  }));
}

router.get(
  '/dashboard/stats',
  asyncHandler(async (_req, res) => {
    const today = isoNow().slice(0, 10);

    const totals = {
      clients: (await get('SELECT COUNT(*) AS n FROM clients')).n,
      invoices: (await get('SELECT COUNT(*) AS n FROM invoices')).n,
      openInvoices: (await get(
        `SELECT COUNT(*) AS n FROM invoices WHERE status IN ('unpaid','awaiting_payment','confirmation_submitted','under_review','rejected','partially_paid')`
      )).n,
      confirmations: (await get('SELECT COUNT(*) AS n FROM payment_confirmations')).n,
    };

    const byStatusRows = await all(
      'SELECT status, COUNT(*) AS n FROM payment_confirmations GROUP BY status'
    );
    const byStatus = {};
    for (const r of byStatusRows) byStatus[r.status] = r.n;

    const outstandingRows = await all(
      `SELECT currency, SUM(amount_cents) AS cents FROM invoices
        WHERE status IN ('unpaid','awaiting_payment','confirmation_submitted','under_review','rejected')
        GROUP BY currency`
    );

    const verifiedRows = await all(
      `SELECT currency, SUM(amount_sent_cents) AS cents FROM payment_confirmations
        WHERE status = 'verified' GROUP BY currency`
    );

    const rejectedCount = (await get(`SELECT COUNT(*) AS n FROM payment_confirmations WHERE status = 'rejected'`)).n;
    const pendingReview = (await get(
      `SELECT COUNT(*) AS n FROM payment_confirmations WHERE status IN ('submitted','under_review')`
    )).n;
    const overdueInvoices = (await get(
      `SELECT COUNT(*) AS n FROM invoices WHERE due_date < ? AND status IN ('unpaid','awaiting_payment','rejected')`,
      [today]
    )).n;
    const suspendedClients = (await get(`SELECT COUNT(*) AS n FROM clients WHERE status = 'suspended'`)).n;

    // Activity over the last 14 days (confirmations created per day).
    const activity = await all(
      `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n
         FROM payment_confirmations
        WHERE created_at >= datetime('now', '-14 days')
        GROUP BY day ORDER BY day`
    );

    const recentConfirmations = await all(
      `SELECT pc.id, pc.status, pc.currency, pc.amount_sent_cents, pc.created_at,
              pr.ref_code, i.invoice_ref, c.full_name AS client_name
         FROM payment_confirmations pc
         JOIN payment_references pr ON pr.id = pc.payment_reference_id
         JOIN invoices i ON i.id = pc.invoice_id
         JOIN clients c ON c.id = pc.client_id
        ORDER BY pc.created_at DESC LIMIT 8`
    );

    const recentAudit = await all(
      'SELECT * FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT 15'
    );

    const notificationsAttention = (await get(
      `SELECT COUNT(*) AS n FROM notifications WHERE status = 'failed'`
    )).n;

    res.json({
      totals,
      confirmationsByStatus: byStatus,
      outstandingByCurrency: sumByCurrency(outstandingRows),
      verifiedByCurrency: sumByCurrency(verifiedRows),
      rejectedCount,
      pendingReview,
      attention: {
        pendingReview,
        overdueInvoices,
        suspendedClients,
        failedNotifications: notificationsAttention,
      },
      activity,
      recentConfirmations: recentConfirmations.map((r) => ({
        ...r,
        amountFormatted: formatMoney(r.amount_sent_cents, r.currency),
      })),
      recentAudit,
    });
  })
);

export default router;
