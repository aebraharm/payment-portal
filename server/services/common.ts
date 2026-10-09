// Helpers shared by the service modules: SQL fragments, row mapping and error classification.

import { PENDING_SUBMISSION_STATUSES, type Currency } from '../../shared/constants';
import { deriveInvoiceStatus, type DerivedInvoiceStatus } from '../../shared/status';
import type { Queryable } from '../db/database';
import { AppError, badRequest } from '../lib/errors';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuid(value: string, label = 'identifier'): string {
  if (!UUID_RE.test(value)) throw badRequest(`Invalid ${label}.`);
  return value;
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const candidate = error as { code?: string; constraint?: string } | null;
  if (!candidate || candidate.code !== '23505') return false;
  return constraint ? candidate.constraint === constraint : true;
}

export async function netPaid(db: Queryable, invoiceId: string): Promise<string> {
  const { rows } = await db.query<{ net: string }>(
    `SELECT COALESCE(SUM(CASE WHEN kind = 'verified_payment' THEN amount ELSE -amount END), 0)::text AS net
       FROM payment_ledger WHERE invoice_id = $1`,
    [invoiceId],
  );
  return rows[0]?.net ?? '0.00';
}

/** Correlated subqueries give the derived invoice state in one query. Callers add WHERE / ORDER clauses. */
export const INVOICE_SUMMARY_SQL = `
  SELECT i.id, i.invoice_number, i.client_id, i.description, i.currency,
         i.total_amount::text AS total_amount, i.issue_date::text AS issue_date, i.due_date::text AS due_date,
         i.partial_payments_allowed, i.status, i.notes, i.cancel_reason, i.created_at,
         c.full_name AS client_name, c.client_code, c.status AS client_status,
         COALESCE((SELECT SUM(CASE WHEN l.kind = 'verified_payment' THEN l.amount ELSE -l.amount END)
                     FROM payment_ledger l WHERE l.invoice_id = i.id), 0)::text AS net_paid,
         EXISTS (SELECT 1 FROM payment_ledger l WHERE l.invoice_id = i.id AND l.kind = 'refund') AS has_refund,
         (SELECT s.status FROM payment_submissions s
            WHERE s.invoice_id = i.id AND s.status IN ('submitted', 'under_review', 'info_requested')
            ORDER BY CASE s.status WHEN 'under_review' THEN 0 WHEN 'info_requested' THEN 1 ELSE 2 END, s.created_at DESC
            LIMIT 1) AS pending_status,
         (SELECT s.status FROM payment_submissions s
            WHERE s.invoice_id = i.id AND s.status IN ('verified', 'rejected')
            ORDER BY s.created_at DESC LIMIT 1) AS latest_closed_status,
         EXISTS (SELECT 1 FROM payment_references r WHERE r.invoice_id = i.id AND r.status = 'issued') AS has_issued_reference
    FROM invoices i
    JOIN clients c ON c.id = i.client_id`;

export interface InvoiceSummaryRow {
  id: string;
  invoice_number: string;
  client_id: string;
  description: string;
  currency: Currency;
  total_amount: string;
  issue_date: string;
  due_date: string;
  partial_payments_allowed: boolean;
  status: 'open' | 'cancelled';
  notes: string;
  cancel_reason: string | null;
  created_at: Date;
  client_name: string;
  client_code: string;
  client_status: string;
  net_paid: string;
  has_refund: boolean;
  pending_status: 'submitted' | 'under_review' | 'info_requested' | null;
  latest_closed_status: 'verified' | 'rejected' | null;
  has_issued_reference: boolean;
}

export interface InvoiceSummary {
  id: string;
  invoiceNumber: string;
  clientId: string;
  clientName: string;
  clientCode: string;
  clientStatus: string;
  description: string;
  currency: Currency;
  totalAmount: string;
  netPaid: string;
  outstanding: string;
  issueDate: string;
  dueDate: string;
  partialPaymentsAllowed: boolean;
  notes: string;
  cancelReason: string | null;
  createdAt: string;
  payment: DerivedInvoiceStatus;
  status: DerivedInvoiceStatus['status'];
  statusLabel: string;
  tone: DerivedInvoiceStatus['tone'];
  overdue: boolean;
}

export function toInvoiceSummary(row: InvoiceSummaryRow, today: string): InvoiceSummary {
  const payment = deriveInvoiceStatus({
    cancelled: row.status === 'cancelled',
    totalAmount: row.total_amount,
    netPaid: row.net_paid,
    hasRefund: row.has_refund,
    pendingStatus: row.pending_status,
    latestClosedStatus: row.latest_closed_status,
    hasIssuedReference: row.has_issued_reference,
    dueDate: row.due_date,
    today,
  });
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    clientId: row.client_id,
    clientName: row.client_name,
    clientCode: row.client_code,
    clientStatus: row.client_status,
    description: row.description,
    currency: row.currency,
    totalAmount: row.total_amount,
    netPaid: row.net_paid,
    outstanding: payment.outstanding,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    partialPaymentsAllowed: row.partial_payments_allowed,
    notes: row.notes,
    cancelReason: row.cancel_reason,
    createdAt: new Date(row.created_at).toISOString(),
    payment,
    status: payment.status,
    statusLabel: payment.label,
    tone: payment.tone,
    overdue: payment.overdue,
  };
}

/** Builds a parameterised IN (...) list. Avoids relying on array parameter support across drivers. */
export function inList(values: readonly string[], startAt = 1): { sql: string; params: string[] } {
  return {
    sql: values.map((_, index) => `$${startAt + index}`).join(', '),
    params: [...values],
  };
}

export function isPendingStatus(status: string): boolean {
  return (PENDING_SUBMISSION_STATUSES as readonly string[]).includes(status);
}

export function assertFound<T>(value: T | undefined | null, error: AppError): T {
  if (value === undefined || value === null) throw error;
  return value;
}
