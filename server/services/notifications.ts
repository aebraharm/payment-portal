// Notifications. A message is marked "sent" only after the mail transport accepted it. When SMTP is not
// configured, the notification is recorded as "not_configured" and nothing claims it was delivered.
// Messages containing one-time links are stored without a body, so the link is never persisted.

import {
  SENSITIVE_TEMPLATE_KEYS,
  TEMPLATE_PLACEHOLDERS,
  type NotificationTemplateKey,
} from '../../shared/constants';
import { daysBetween, formatIsoDate } from '../../shared/dates';
import { formatMoney } from '../../shared/money';
import { todayFor, type Deps } from '../deps';
import type { Queryable } from '../db/database';
import { conflict, notFound, unprocessable } from '../lib/errors';
import { errorFields, log } from '../lib/logger';
import { recordAudit, type Actor } from './audit';
import { INVOICE_SUMMARY_SQL, toInvoiceSummary, type InvoiceSummary, type InvoiceSummaryRow } from './common';
import { readPublished, readPublishedGroup } from './settings';

export type TemplateContext = Partial<Record<(typeof TEMPLATE_PLACEHOLDERS)[number], string>>;

export type NotificationOutcome = 'sent' | 'failed' | 'not_configured' | 'skipped' | 'duplicate' | 'disabled';

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export function renderTemplate(template: string, context: TemplateContext): string {
  return template.replace(PLACEHOLDER, (match, key: string) =>
    (TEMPLATE_PLACEHOLDERS as readonly string[]).includes(key) ? (context[key as keyof TemplateContext] ?? '') : match,
  );
}

const SAMPLE_CONTEXT: TemplateContext = {
  agencyName: 'Your agency',
  clientName: 'Ada Example',
  clientCode: 'CL-000001',
  invoiceNumber: 'INV-2026-00001',
  invoiceDescription: 'Sample invoice description',
  amount: 'USD 1,250.00',
  currency: 'USD',
  dueDate: '31 Oct 2026',
  reference: 'PAY-20261009-K7QF2M',
  status: 'Awaiting payment',
  reason: 'The receipt does not show the transfer date.',
  message: 'Please upload a clearer copy of the receipt.',
  transferReference: 'TR-0001',
  receiptStatus: 'Attached',
  portalUrl: 'https://portal.example.test/client',
  supportEmail: 'support@example.test',
  activationUrl: 'https://portal.example.test/client/activate#token=sample',
  resetUrl: 'https://portal.example.test/admin/reset-password#token=sample',
};

/** Renders a draft template with sample values, for the admin preview. Nothing is sent. */
export function previewTemplate(subject: string, body: string): { subject: string; body: string; sampleValues: TemplateContext } {
  return {
    subject: renderTemplate(subject, SAMPLE_CONTEXT).replace(/[\r\n]+/g, ' '),
    body: renderTemplate(body, SAMPLE_CONTEXT),
    sampleValues: SAMPLE_CONTEXT,
  };
}

export async function brandContext(deps: Deps): Promise<{ agencyName: string; supportEmail: string; portalUrl: string }> {
  const settings = await readPublished(deps.db);
  return {
    agencyName: settings.branding.agencyName || 'the agency',
    supportEmail: settings.contact.supportEmail,
    portalUrl: `${deps.config.appUrl}/client`,
  };
}

export function invoiceContext(
  brand: { agencyName: string; supportEmail: string; portalUrl: string },
  invoice: Pick<InvoiceSummary, 'invoiceNumber' | 'description' | 'dueDate' | 'clientName' | 'clientCode' | 'currency'>,
  amount: string,
): TemplateContext {
  return {
    agencyName: brand.agencyName,
    clientName: invoice.clientName,
    clientCode: invoice.clientCode,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDescription: invoice.description,
    amount: formatMoney(amount, invoice.currency),
    currency: invoice.currency,
    dueDate: formatIsoDate(invoice.dueDate),
    supportEmail: brand.supportEmail,
    portalUrl: brand.portalUrl,
  };
}

export interface EnqueueInput {
  templateKey: NotificationTemplateKey;
  recipient: { type: 'client'; clientId: string; address: string } | { type: 'admin'; address: string };
  context: TemplateContext;
  dedupeKey: string | null;
  invoiceId?: string | null;
  submissionId?: string | null;
}

function briefError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/g, ' ').slice(0, 300);
}

export async function enqueueNotification(deps: Deps, input: EnqueueInput): Promise<NotificationOutcome> {
  const { db, mailer } = deps;
  const now = deps.now();
  const templates = await readPublishedGroup(db, 'notifications');
  const template = templates[input.templateKey];
  if (!template.enabled) return 'disabled';

  const subject = renderTemplate(template.subject, input.context).replace(/[\r\n]+/g, ' ').slice(0, 200);
  const body = renderTemplate(template.body, input.context);
  const sensitive = (SENSITIVE_TEMPLATE_KEYS as readonly string[]).includes(input.templateKey);
  const address = input.recipient.address.trim();
  const clientId = input.recipient.type === 'client' ? input.recipient.clientId : null;

  const inserted = await db.query<{ id: string }>(
    `INSERT INTO notifications
       (template_key, recipient_type, client_id, recipient_address, subject, body, status, dedupe_key,
        invoice_id, submission_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7, $8, $9, $10, $10)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING id`,
    [
      input.templateKey,
      input.recipient.type,
      clientId,
      address,
      subject,
      sensitive ? null : body,
      input.dedupeKey,
      input.invoiceId ?? null,
      input.submissionId ?? null,
      now,
    ],
  );
  if (inserted.rowCount === 0) return 'duplicate';
  const id = inserted.rows[0].id;

  const finish = (status: string, error: string | null, sentAt: Date | null) =>
    db.query(
      `UPDATE notifications SET status = $2, last_error = $3, sent_at = $4, attempts = attempts + 1, updated_at = $5 WHERE id = $1`,
      [id, status, error, sentAt, deps.now()],
    );

  if (!address) {
    await finish('skipped', 'No recipient address is on file.', null);
    return 'skipped';
  }
  if (!mailer.configured) {
    await finish('not_configured', 'Email delivery is not configured. Set the SMTP environment variables to send.', null);
    return 'not_configured';
  }
  try {
    await mailer.send({ to: address, subject, text: body });
    await finish('sent', null, deps.now());
    return 'sent';
  } catch (error) {
    log('warn', 'notification.send_failed', { templateKey: input.templateKey, ...errorFields(error) });
    await finish('failed', briefError(error), null);
    return 'failed';
  }
}

/** Sends a message without throwing. Used after a business action has committed. */
export async function notifySafely(deps: Deps, input: EnqueueInput): Promise<NotificationOutcome> {
  try {
    return await enqueueNotification(deps, input);
  } catch (error) {
    log('error', 'notification.enqueue_failed', { templateKey: input.templateKey, ...errorFields(error) });
    return 'failed';
  }
}

export async function retryNotification(deps: Deps, id: string, actor: Actor): Promise<NotificationOutcome> {
  const { db, mailer } = deps;
  const now = deps.now();
  const { rows } = await db.query<{
    id: string;
    status: string;
    body: string | null;
    subject: string;
    recipient_address: string;
    template_key: string;
  }>('SELECT id, status, body, subject, recipient_address, template_key FROM notifications WHERE id = $1', [id]);
  const row = rows[0];
  if (!row) throw notFound('That notification does not exist.');
  if (!['failed', 'not_configured'].includes(row.status)) throw conflict('Only failed or unsent messages can be retried.');
  if ((SENSITIVE_TEMPLATE_KEYS as readonly string[]).includes(row.template_key) || row.body === null) {
    throw unprocessable('This message contains a one-time link and cannot be resent. Issue a new link instead.', {});
  }
  if (!mailer.configured) {
    throw unprocessable('Email delivery is not configured. Set the SMTP environment variables first.', {});
  }
  try {
    await mailer.send({ to: row.recipient_address, subject: row.subject, text: row.body });
    await db.query(
      `UPDATE notifications SET status = 'sent', sent_at = $2, attempts = attempts + 1, last_error = NULL, updated_at = $2 WHERE id = $1`,
      [id, now],
    );
    await recordAudit(db, actor, { action: 'notification.retried', summary: 'Retried a notification', entityType: 'notification', entityId: id }, now);
    return 'sent';
  } catch (error) {
    await db.query(
      `UPDATE notifications SET status = 'failed', attempts = attempts + 1, last_error = $2, updated_at = $3 WHERE id = $1`,
      [id, briefError(error), now],
    );
    return 'failed';
  }
}

export interface NotificationRow {
  id: string;
  templateKey: string;
  recipientType: string;
  recipientAddress: string;
  subject: string;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
}

export async function listNotifications(db: Queryable, filter: { status?: string; clientId?: string }, limit = 100): Promise<NotificationRow[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (filter.status) {
    params.push(filter.status);
    where.push(`status = $${params.length}`);
  }
  if (filter.clientId) {
    params.push(filter.clientId);
    where.push(`client_id = $${params.length}`);
  }
  params.push(limit);
  const { rows } = await db.query<{
    id: string;
    template_key: string;
    recipient_type: string;
    recipient_address: string;
    subject: string;
    status: string;
    attempts: number;
    last_error: string | null;
    created_at: Date;
    sent_at: Date | null;
  }>(
    `SELECT id, template_key, recipient_type, recipient_address, subject, status, attempts, last_error, created_at, sent_at
       FROM notifications ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map((row) => ({
    id: row.id,
    templateKey: row.template_key,
    recipientType: row.recipient_type,
    recipientAddress: row.recipient_address,
    subject: row.subject,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    createdAt: new Date(row.created_at).toISOString(),
    sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null,
  }));
}

/** Clients see only messages that were actually sent. Failures and pending states are staff-only. */
export async function clientVisibleNotifications(db: Queryable, clientId: string): Promise<{ id: string; subject: string; sentAt: string }[]> {
  const { rows } = await db.query<{ id: string; subject: string; sent_at: Date }>(
    `SELECT id, subject, sent_at FROM notifications
      WHERE client_id = $1 AND recipient_type = 'client' AND status = 'sent'
      ORDER BY sent_at DESC LIMIT 20`,
    [clientId],
  );
  return rows.map((row) => ({ id: row.id, subject: row.subject, sentAt: new Date(row.sent_at).toISOString() }));
}

/** Invoice reminders. Run daily by the scheduled function. Idempotent: each reminder has a dedupe key. */
export async function sweepReminders(deps: Deps): Promise<{ dueSoon: number; overdue: number; skipped: number; disabled: boolean }> {
  const { db } = deps;
  const today = todayFor(deps);
  const ops = await readPublishedGroup(db, 'operations');
  const result = { dueSoon: 0, overdue: 0, skipped: 0, disabled: false };
  const { rows } = await db.query<InvoiceSummaryRow>(`${INVOICE_SUMMARY_SQL} WHERE i.status = 'open'`);
  const brand = await brandContext(deps);
  for (const row of rows) {
    const invoice = toInvoiceSummary(row, today);
    if (invoice.clientStatus !== 'active') continue;
    if (['payment_verified', 'refunded', 'cancelled'].includes(invoice.status)) continue;
    const daysUntilDue = daysBetween(today, invoice.dueDate);
    const context = invoiceContext(brand, invoice, invoice.outstanding);
    const address = (await db.query<{ email: string }>('SELECT email FROM clients WHERE id = $1', [invoice.clientId])).rows[0]?.email ?? '';
    const recipient = { type: 'client' as const, clientId: invoice.clientId, address };

    if (daysUntilDue >= 0 && ops.reminderDaysBefore.includes(daysUntilDue)) {
      const outcome = await enqueueNotification(deps, {
        templateKey: 'invoice_due_soon',
        recipient,
        context,
        dedupeKey: `due-soon:${invoice.id}:${invoice.dueDate}:${daysUntilDue}`,
        invoiceId: invoice.id,
      });
      if (outcome === 'duplicate') result.skipped += 1;
      else result.dueSoon += 1;
    }
    const daysOverdue = daysBetween(invoice.dueDate, today);
    if (daysOverdue > 0 && ops.overdueReminderEveryDays > 0 && daysOverdue % ops.overdueReminderEveryDays === 0) {
      const outcome = await enqueueNotification(deps, {
        templateKey: 'invoice_overdue',
        recipient,
        context,
        dedupeKey: `overdue:${invoice.id}:${today}`,
        invoiceId: invoice.id,
      });
      if (outcome === 'duplicate') result.skipped += 1;
      else result.overdue += 1;
    }
  }
  return result;
}

