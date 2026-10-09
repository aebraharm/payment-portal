// Invoices. Totals are always computed on the server from line items. Once any payment activity exists,
// the amount and currency are locked, so the financial record cannot be rewritten after the fact.

import { compareAmounts, fromMinor, toMinor } from '../../shared/money';
import type { InvoiceCreateInput, InvoiceUpdateInput } from '../../shared/schemas';
import { todayFor, type Deps } from '../deps';
import type { Queryable } from '../db/database';
import { conflict, notFound, unprocessable } from '../lib/errors';
import { recordAudit, type Actor } from './audit';
import { INVOICE_SUMMARY_SQL, netPaid, requireUuid, toInvoiceSummary, type InvoiceSummary, type InvoiceSummaryRow } from './common';
import { nextSequence } from './clients';
import { listNotes } from './notes';
import { brandContext, invoiceContext, notifySafely } from './notifications';
import { readPublishedGroup } from './settings';

export interface LineItemInput {
  description: string;
  kind: 'charge' | 'fee' | 'discount';
  amount: string;
}

/** Charges and fees add; discounts subtract. Uses integer minor units, never floating point. */
export function computeTotal(lineItems: readonly LineItemInput[]): string {
  let total = 0n;
  for (const item of lineItems) {
    const minor = toMinor(item.amount);
    total += item.kind === 'discount' ? -minor : minor;
  }
  return fromMinor(total);
}

export function formatInvoiceNumber(format: string, issueDate: string, sequence: number): string {
  const [year, month] = issueDate.split('-');
  return format.replace(/\{(YYYY|YY|MM|SEQ)(?::(\d{1,2}))?\}/g, (_match, token: string, width?: string) => {
    if (token === 'YYYY') return year;
    if (token === 'YY') return year.slice(2);
    if (token === 'MM') return month;
    return String(sequence).padStart(Number(width ?? 1), '0');
  });
}

export async function hasPaymentActivity(db: Queryable, invoiceId: string): Promise<boolean> {
  const { rows } = await db.query<{ active: boolean }>(
    `SELECT (EXISTS (SELECT 1 FROM payment_ledger WHERE invoice_id = $1)
          OR EXISTS (SELECT 1 FROM payment_submissions WHERE invoice_id = $1 AND status <> 'rejected')) AS active`,
    [invoiceId],
  );
  return rows[0]?.active === true;
}

export async function createInvoice(deps: Deps, input: InvoiceCreateInput, actor: Actor): Promise<InvoiceSummary> {
  const { db } = deps;
  const now = deps.now();
  const client = await db.query<{ id: string; full_name: string }>('SELECT id, full_name FROM clients WHERE id = $1', [input.clientId]);
  if (!client.rows[0]) throw notFound('That client does not exist.');
  const total = computeTotal(input.lineItems);
  if (compareAmounts(total, '0.00') <= 0) {
    throw unprocessable('The invoice total must be greater than zero.', { lineItems: 'The total after discounts is zero or less.' });
  }
  const ops = await readPublishedGroup(db, 'operations');
  const invoiceId = await db.transaction(async (tx) => {
    const sequence = await nextSequence(tx, 'invoice');
    const invoiceNumber = formatInvoiceNumber(ops.invoiceNumberFormat, input.issueDate, sequence);
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO invoices (invoice_number, client_id, description, currency, total_amount, issue_date, due_date,
                             partial_payments_allowed, notes, status, created_at, created_by, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open', $10, $11, $10, $11)
       RETURNING id`,
      [
        invoiceNumber,
        input.clientId,
        input.description,
        input.currency,
        total,
        input.issueDate,
        input.dueDate,
        input.partialPaymentsAllowed,
        input.notes,
        now,
        actor.id,
      ],
    );
    const id = inserted.rows[0].id;
    for (const [index, item] of input.lineItems.entries()) {
      await tx.query(
        'INSERT INTO invoice_line_items (invoice_id, description, kind, amount, sort_order) VALUES ($1, $2, $3, $4, $5)',
        [id, item.description, item.kind, item.amount, index],
      );
    }
    await recordAudit(
      tx,
      actor,
      {
        action: 'invoice.created',
        summary: `Created invoice ${invoiceNumber}`,
        entityType: 'invoice',
        entityId: id,
        metadata: { currency: input.currency, total, clientId: input.clientId, lineItemCount: input.lineItems.length },
      },
      now,
    );
    return id;
  });

  const invoice = await getInvoiceSummary(deps, invoiceId);
  const brand = await brandContext(deps);
  const address = (await db.query<{ email: string }>('SELECT email FROM clients WHERE id = $1', [input.clientId])).rows[0]?.email ?? '';
  await notifySafely(deps, {
    templateKey: 'invoice_created',
    recipient: { type: 'client', clientId: input.clientId, address },
    context: invoiceContext(brand, invoice, invoice.totalAmount),
    dedupeKey: `invoice-created:${invoiceId}`,
    invoiceId,
  });
  return invoice;
}

export async function getInvoiceSummary(deps: Deps, id: string): Promise<InvoiceSummary> {
  const { rows } = await deps.db.query<InvoiceSummaryRow>(`${INVOICE_SUMMARY_SQL} WHERE i.id = $1`, [requireUuid(id, 'invoice')]);
  if (!rows[0]) throw notFound('That invoice does not exist.');
  return toInvoiceSummary(rows[0], todayFor(deps));
}

export async function getInvoiceForClient(deps: Deps, clientId: string, invoiceId: string): Promise<InvoiceSummary> {
  const { rows } = await deps.db.query<InvoiceSummaryRow>(`${INVOICE_SUMMARY_SQL} WHERE i.id = $1 AND i.client_id = $2`, [
    requireUuid(invoiceId, 'invoice'),
    clientId,
  ]);
  if (!rows[0]) throw notFound('We could not find that invoice.');
  return toInvoiceSummary(rows[0], todayFor(deps));
}

export async function listInvoices(
  deps: Deps,
  filter: { clientId?: string; q?: string; status?: string },
): Promise<InvoiceSummary[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (filter.clientId) {
    params.push(filter.clientId);
    where.push(`i.client_id = $${params.length}`);
  }
  if (filter.q) {
    const pattern = `%${filter.q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    params.push(pattern);
    where.push(`(i.invoice_number ILIKE $${params.length} OR c.full_name ILIKE $${params.length} OR i.description ILIKE $${params.length})`);
  }
  const { rows } = await deps.db.query<InvoiceSummaryRow>(
    `${INVOICE_SUMMARY_SQL} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY i.due_date ASC, i.created_at DESC LIMIT 300`,
    params,
  );
  const today = todayFor(deps);
  const summaries = rows.map((row) => toInvoiceSummary(row, today));
  return filter.status ? summaries.filter((item) => item.status === filter.status) : summaries;
}

export async function listLineItems(db: Queryable, invoiceId: string) {
  const { rows } = await db.query<{ description: string; kind: string; amount: string }>(
    `SELECT description, kind, amount::text AS amount FROM invoice_line_items WHERE invoice_id = $1 ORDER BY sort_order, id`,
    [invoiceId],
  );
  return rows;
}

export async function updateInvoice(deps: Deps, id: string, input: InvoiceUpdateInput, actor: Actor): Promise<InvoiceSummary> {
  const { db } = deps;
  const now = deps.now();
  requireUuid(id, 'invoice');
  const before = await getInvoiceSummary(deps, id);
  if (before.status === 'cancelled') throw conflict('Cancelled invoices cannot be edited.');

  const activity = await hasPaymentActivity(db, id);
  const financialChange = input.lineItems !== undefined || input.currency !== undefined;
  if (financialChange && activity) {
    throw conflict(
      'This invoice already has payment activity, so its amount and currency are locked. Cancel it if it was issued in error and create a replacement.',
    );
  }
  const issueDate = input.issueDate ?? before.issueDate;
  const dueDate = input.dueDate ?? before.dueDate;
  if (dueDate < issueDate) throw unprocessable('The due date cannot be before the issue date.', { dueDate: 'Choose a later date.' });

  const total = input.lineItems ? computeTotal(input.lineItems) : before.totalAmount;
  if (compareAmounts(total, '0.00') <= 0) {
    throw unprocessable('The invoice total must be greater than zero.', { lineItems: 'The total after discounts is zero or less.' });
  }

  await db.transaction(async (tx) => {
    if (input.lineItems) {
      await tx.query('DELETE FROM invoice_line_items WHERE invoice_id = $1', [id]);
      for (const [index, item] of input.lineItems.entries()) {
        await tx.query(
          'INSERT INTO invoice_line_items (invoice_id, description, kind, amount, sort_order) VALUES ($1, $2, $3, $4, $5)',
          [id, item.description, item.kind, item.amount, index],
        );
      }
    }
    await tx.query(
      `UPDATE invoices SET description = $2, currency = $3, total_amount = $4, issue_date = $5, due_date = $6,
              partial_payments_allowed = $7, notes = $8, updated_at = $9, updated_by = $10
        WHERE id = $1`,
      [
        id,
        input.description ?? before.description,
        input.currency ?? before.currency,
        total,
        issueDate,
        dueDate,
        input.partialPaymentsAllowed ?? before.partialPaymentsAllowed,
        input.notes ?? before.notes,
        now,
        actor.id,
      ],
    );
    const changed = [
      input.description !== undefined && input.description !== before.description ? 'description' : null,
      input.currency !== undefined && input.currency !== before.currency ? 'currency' : null,
      total !== before.totalAmount ? 'totalAmount' : null,
      issueDate !== before.issueDate ? 'issueDate' : null,
      dueDate !== before.dueDate ? 'dueDate' : null,
      input.partialPaymentsAllowed !== undefined && input.partialPaymentsAllowed !== before.partialPaymentsAllowed ? 'partialPaymentsAllowed' : null,
      input.notes !== undefined && input.notes !== before.notes ? 'notes' : null,
      input.lineItems ? 'lineItems' : null,
    ].filter(Boolean);
    await recordAudit(
      tx,
      actor,
      {
        action: 'invoice.updated',
        summary: `Updated invoice ${before.invoiceNumber}`,
        entityType: 'invoice',
        entityId: id,
        metadata: { changedFields: changed, totalFrom: before.totalAmount, totalTo: total },
      },
      now,
    );
  });
  return getInvoiceSummary(deps, id);
}

export async function cancelInvoice(deps: Deps, id: string, reason: string, actor: Actor): Promise<void> {
  const { db } = deps;
  const now = deps.now();
  requireUuid(id, 'invoice');
  await db.transaction(async (tx) => {
    const { rows } = await tx.query<{ invoice_number: string; status: string }>(
      'SELECT invoice_number, status FROM invoices WHERE id = $1 FOR UPDATE',
      [id],
    );
    const invoice = rows[0];
    if (!invoice) throw notFound('That invoice does not exist.');
    if (invoice.status === 'cancelled') throw conflict('This invoice is already cancelled.');
    const pending = await tx.query(
      `SELECT 1 FROM payment_submissions WHERE invoice_id = $1 AND status IN ('submitted', 'under_review', 'info_requested') LIMIT 1`,
      [id],
    );
    if (pending.rowCount > 0) throw conflict('Resolve the pending payment confirmation before cancelling this invoice.');
    const ledger = await tx.query('SELECT 1 FROM payment_ledger WHERE invoice_id = $1 LIMIT 1', [id]);
    if (ledger.rowCount > 0) throw conflict('This invoice has payment history and cannot be cancelled. Keep it for the record.');
    await tx.query(
      `UPDATE invoices SET status = 'cancelled', cancel_reason = $2, cancelled_at = $3, updated_at = $3, updated_by = $4 WHERE id = $1`,
      [id, reason, now, actor.id],
    );
    await tx.query(`UPDATE payment_references SET status = 'cancelled' WHERE invoice_id = $1 AND status = 'issued'`, [id]);
    await recordAudit(
      tx,
      actor,
      { action: 'invoice.cancelled', summary: `Cancelled invoice ${invoice.invoice_number}`, entityType: 'invoice', entityId: id, metadata: { reason } },
      now,
    );
  });
}

export async function invoiceDetail(deps: Deps, id: string) {
  const { db } = deps;
  const invoice = await getInvoiceSummary(deps, id);
  const lineItems = await listLineItems(db, id);
  const references = await db.query<{ id: string; reference: string; method: string; currency: string; amount: string; status: string; created_at: Date }>(
    `SELECT id, reference, method, currency, amount::text AS amount, status, created_at FROM payment_references WHERE invoice_id = $1 ORDER BY created_at DESC`,
    [id],
  );
  const submissions = await db.query<{ id: string; reference: string; status: string; amount_sent: string; sent_on: string; created_at: Date; receipt_count: number; method: string }>(
    `SELECT s.id, r.reference, s.status, s.amount_sent::text AS amount_sent, s.sent_on::text AS sent_on, s.created_at, s.method,
            (SELECT COUNT(*)::int FROM receipts rc WHERE rc.submission_id = s.id) AS receipt_count
       FROM payment_submissions s JOIN payment_references r ON r.id = s.reference_id
      WHERE s.invoice_id = $1 ORDER BY s.created_at DESC`,
    [id],
  );
  const ledger = await db.query<{ id: string; kind: string; amount: string; currency: string; recorded_at: Date; note: string }>(
    `SELECT id, kind, amount::text AS amount, currency, recorded_at, reference_note AS note FROM payment_ledger WHERE invoice_id = $1 ORDER BY recorded_at DESC`,
    [id],
  );
  const audit = await db.query<{ id: string; occurred_at: Date; action: string; summary: string; actor_type: string }>(
    `SELECT id, occurred_at, action, summary, actor_type FROM audit_events WHERE entity_type = 'invoice' AND entity_id = $1 ORDER BY id DESC LIMIT 50`,
    [id],
  );
  return {
    invoice,
    lineItems,
    references: references.rows.map((row) => ({
      id: row.id,
      reference: row.reference,
      method: row.method,
      currency: row.currency,
      amount: row.amount,
      status: row.status,
      createdAt: new Date(row.created_at).toISOString(),
    })),
    submissions: submissions.rows.map((row) => ({
      id: row.id,
      reference: row.reference,
      method: row.method,
      status: row.status,
      amountSent: row.amount_sent,
      sentOn: row.sent_on,
      receiptCount: row.receipt_count,
      createdAt: new Date(row.created_at).toISOString(),
    })),
    ledger: ledger.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      amount: row.amount,
      currency: row.currency,
      note: row.note,
      recordedAt: new Date(row.recorded_at).toISOString(),
    })),
    notes: await listNotes(db, 'invoice', id),
    audit: audit.rows.map((row) => ({
      id: row.id,
      occurredAt: new Date(row.occurred_at).toISOString(),
      action: row.action,
      summary: row.summary,
      actorType: row.actor_type,
    })),
    netPaid: await netPaid(db, id),
  };
}

