// Administrator read models: dashboard statistics (computed from the database, never hard-coded),
// audit log listing and CSV exports.

import { formatMoney, fromMinor, sumAmounts, subtractAmounts } from '../../shared/money';
import { SUBMISSION_STATUS_META } from '../../shared/status';
import { SUBMISSION_STATUSES } from '../../shared/constants';
import { daysBetween, todayIn } from '../../shared/dates';
import { todayFor, type Deps } from '../deps';
import type { Queryable } from '../db/database';
import { INVOICE_SUMMARY_SQL, toInvoiceSummary, type InvoiceSummaryRow } from './common';
import { listNotifications } from './notifications';

export async function adminDashboard(deps: Deps) {
  const { db } = deps;
  const today = todayFor(deps);
  const counts = await db.query<{
    active_clients: number;
    awaiting_review: number;
    info_requested: number;
    failed_notifications: number;
    not_configured_notifications: number;
  }>(
    `SELECT
       (SELECT COUNT(*)::int FROM clients WHERE status = 'active') AS active_clients,
       (SELECT COUNT(*)::int FROM payment_submissions WHERE status IN ('submitted', 'under_review')) AS awaiting_review,
       (SELECT COUNT(*)::int FROM payment_submissions WHERE status = 'info_requested') AS info_requested,
       (SELECT COUNT(*)::int FROM notifications WHERE status = 'failed') AS failed_notifications,
       (SELECT COUNT(*)::int FROM notifications WHERE status = 'not_configured') AS not_configured_notifications`,
  );

  const invoices = (await db.query<InvoiceSummaryRow>(`${INVOICE_SUMMARY_SQL} WHERE i.status = 'open'`)).rows.map((row) =>
    toInvoiceSummary(row, today),
  );
  const outstanding = new Map<string, { invoices: number; billed: string[]; outstanding: string[] }>();
  for (const invoice of invoices) {
    const entry = outstanding.get(invoice.currency) ?? { invoices: 0, billed: [], outstanding: [] };
    entry.invoices += 1;
    entry.billed.push(invoice.totalAmount);
    entry.outstanding.push(invoice.outstanding);
    outstanding.set(invoice.currency, entry);
  }

  const ledgerTotals = await db.query<{ currency: string; kind: string; total: string }>(
    `SELECT currency, kind, SUM(amount)::text AS total FROM payment_ledger GROUP BY currency, kind`,
  );
  const verified = new Map<string, { verified: string; refunded: string }>();
  for (const row of ledgerTotals.rows) {
    const entry = verified.get(row.currency) ?? { verified: '0.00', refunded: '0.00' };
    if (row.kind === 'verified_payment') entry.verified = row.total;
    else entry.refunded = row.total;
    verified.set(row.currency, entry);
  }

  const since = new Date(deps.now().getTime() - 183 * 86_400_000);
  const recent = await db.query<{ kind: string; currency: string; amount: string; recorded_at: Date }>(
    `SELECT kind, currency, amount::text AS amount, recorded_at FROM payment_ledger WHERE recorded_at >= $1`,
    [since],
  );
  const monthly = new Map<string, Map<string, bigint>>();
  for (const row of recent.rows) {
    const month = todayIn(deps.config.timeZone, new Date(row.recorded_at)).slice(0, 7);
    const byCurrency = monthly.get(month) ?? new Map<string, bigint>();
    const cents = BigInt(Math.round(Number(row.amount) * 100));
    byCurrency.set(row.currency, (byCurrency.get(row.currency) ?? 0n) + (row.kind === 'refund' ? -cents : cents));
    monthly.set(month, byCurrency);
  }

  const statuses = await db.query<{ status: string; count: number }>(
    'SELECT status, COUNT(*)::int AS count FROM payment_submissions GROUP BY status',
  );
  const byStatus = new Map(statuses.rows.map((row) => [row.status, row.count]));

  const audit = await db.query<{ id: string; occurred_at: Date; action: string; summary: string; actor_type: string }>(
    `SELECT id, occurred_at, action, summary, actor_type FROM audit_events ORDER BY id DESC LIMIT 10`,
  );
  const attention = await db.query<{ id: string; created_at: Date; reference: string; client_name: string; invoice_number: string }>(
    `SELECT s.id, s.created_at, r.reference, c.full_name AS client_name, i.invoice_number
       FROM payment_submissions s
       JOIN payment_references r ON r.id = s.reference_id
       JOIN invoices i ON i.id = s.invoice_id
       JOIN clients c ON c.id = s.client_id
      WHERE s.status IN ('submitted', 'under_review')
      ORDER BY s.created_at ASC LIMIT 5`,
  );

  const totals = counts.rows[0];
  return {
    generatedAt: deps.now().toISOString(),
    timeZone: deps.config.timeZone,
    totals: {
      activeClients: totals.active_clients,
      openInvoices: invoices.length,
      overdueInvoices: invoices.filter((invoice) => invoice.overdue).length,
      awaitingReview: totals.awaiting_review,
      infoRequested: totals.info_requested,
      failedNotifications: totals.failed_notifications,
      notConfiguredNotifications: totals.not_configured_notifications,
    },
    outstandingByCurrency: [...outstanding.entries()].map(([currency, entry]) => ({
      currency,
      invoices: entry.invoices,
      billed: sumAmounts(entry.billed),
      outstanding: sumAmounts(entry.outstanding),
      outstandingFormatted: formatMoney(sumAmounts(entry.outstanding), currency),
    })),
    verifiedByCurrency: [...verified.entries()].map(([currency, entry]) => ({
      currency,
      verified: entry.verified,
      refunded: entry.refunded,
      net: subtractAmounts(entry.verified, entry.refunded),
      netFormatted: formatMoney(subtractAmounts(entry.verified, entry.refunded), currency),
    })),
    monthlyNet: [...monthly.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([month, byCurrency]) =>
        [...byCurrency.entries()].map(([currency, cents]) => ({ month, currency, net: fromMinor(cents) })),
      ),
    submissionsByStatus: SUBMISSION_STATUSES.map((status) => ({
      status,
      label: SUBMISSION_STATUS_META[status].label,
      count: byStatus.get(status) ?? 0,
    })),
    attention: attention.rows.map((row) => ({
      id: row.id,
      reference: row.reference,
      clientName: row.client_name,
      invoiceNumber: row.invoice_number,
      waitingDays: Math.max(0, daysBetween(todayIn(deps.config.timeZone, new Date(row.created_at)), today)),
    })),
    recentActivity: audit.rows.map((row) => ({
      id: row.id,
      occurredAt: new Date(row.occurred_at).toISOString(),
      action: row.action,
      summary: row.summary,
      actorType: row.actor_type,
    })),
    recentNotifications: await listNotifications(db, { status: 'failed' }, 5),
  };
}

export async function listAuditEvents(
  db: Queryable,
  filter: { entityType?: string; entityId?: string; action?: string; limit: number },
) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (filter.entityType) {
    params.push(filter.entityType);
    where.push(`entity_type = $${params.length}`);
  }
  if (filter.entityId) {
    params.push(filter.entityId);
    where.push(`entity_id = $${params.length}`);
  }
  if (filter.action) {
    params.push(`${filter.action}%`);
    where.push(`action LIKE $${params.length}`);
  }
  params.push(filter.limit);
  const { rows } = await db.query<{
    id: string;
    occurred_at: Date;
    actor_type: string;
    actor_id: string | null;
    action: string;
    entity_type: string | null;
    entity_id: string | null;
    summary: string;
    metadata: unknown;
  }>(
    `SELECT id, occurred_at, actor_type, actor_id, action, entity_type, entity_id, summary, metadata
       FROM audit_events ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY id DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map((row) => ({
    id: row.id,
    occurredAt: new Date(row.occurred_at).toISOString(),
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    summary: row.summary,
    metadata: row.metadata,
  }));
}

/** Escapes a value for CSV and neutralises spreadsheet formula injection. */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))].join('\r\n') + '\r\n';
}

export async function submissionsCsv(db: Queryable, filter: { from?: string; to?: string; status?: string }): Promise<string> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (filter.from) {
    params.push(filter.from);
    where.push(`s.created_at >= $${params.length}::date`);
  }
  if (filter.to) {
    params.push(filter.to);
    where.push(`s.created_at < ($${params.length}::date + interval '1 day')`);
  }
  if (filter.status) {
    params.push(filter.status);
    where.push(`s.status = $${params.length}`);
  }
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT s.created_at, r.reference, i.invoice_number, c.client_code, c.full_name, s.method, s.currency,
            s.amount_sent::text AS amount_sent, s.sent_on::text AS sent_on, s.status,
            s.verified_amount::text AS verified_amount, s.transfer_reference, s.transaction_id, s.reviewed_at
       FROM payment_submissions s
       JOIN payment_references r ON r.id = s.reference_id
       JOIN invoices i ON i.id = s.invoice_id
       JOIN clients c ON c.id = s.client_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY s.created_at`,
    params,
  );
  return toCsv(
    ['submitted_at', 'reference', 'invoice', 'client_code', 'client_name', 'method', 'currency', 'amount_sent', 'sent_on', 'status', 'verified_amount', 'transfer_reference', 'transaction_id', 'reviewed_at'],
    rows.map((row) => [
      row.created_at ? new Date(row.created_at as Date).toISOString() : '',
      row.reference,
      row.invoice_number,
      row.client_code,
      row.full_name,
      row.method,
      row.currency,
      row.amount_sent,
      row.sent_on,
      row.status,
      row.verified_amount ?? '',
      row.transfer_reference,
      row.transaction_id,
      row.reviewed_at ? new Date(row.reviewed_at as Date).toISOString() : '',
    ]),
  );
}

export async function ledgerCsv(db: Queryable, filter: { from?: string; to?: string }): Promise<string> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (filter.from) {
    params.push(filter.from);
    where.push(`l.recorded_at >= $${params.length}::date`);
  }
  if (filter.to) {
    params.push(filter.to);
    where.push(`l.recorded_at < ($${params.length}::date + interval '1 day')`);
  }
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT l.recorded_at, i.invoice_number, c.client_code, l.kind, l.amount::text AS amount, l.currency,
            l.reference_note, a.display_name AS recorded_by
       FROM payment_ledger l
       JOIN invoices i ON i.id = l.invoice_id
       JOIN clients c ON c.id = i.client_id
       LEFT JOIN admin_users a ON a.id = l.recorded_by
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY l.recorded_at`,
    params,
  );
  return toCsv(
    ['recorded_at', 'invoice', 'client_code', 'entry_type', 'amount', 'currency', 'note', 'recorded_by'],
    rows.map((row) => [
      row.recorded_at ? new Date(row.recorded_at as Date).toISOString() : '',
      row.invoice_number,
      row.client_code,
      row.kind,
      row.amount,
      row.currency,
      row.reference_note,
      row.recorded_by ?? '',
    ]),
  );
}
