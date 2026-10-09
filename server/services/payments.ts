// Payment references, confirmations and review.
//
// Rules enforced here, because the browser cannot be trusted with them:
// - The amount is calculated on the server from the outstanding balance. A smaller amount is accepted only
//   when the invoice allows partial payments, and never above the balance.
// - Invoices are payable only in their own currency. No conversion is performed.
// - A client's confirmation never marks an invoice paid. Only an administrator's verification writes a
//   "verified_payment" ledger entry, and the verified amount is checked against the outstanding balance.
// - One confirmation may be under review per reference. Requests carry idempotency keys, so repeated
//   submissions return the original result instead of creating duplicates.

import { randomUUID } from 'node:crypto';
import {
  CARD_UNAVAILABLE_LABEL,
  PAYMENT_METHOD_LABELS,
  type Currency,
  type PaymentMethod,
  type SubmissionStatus,
} from '../../shared/constants';
import { fieldsFor, SENSITIVE_BANK_KEYS, transferTypeLabel } from '../../shared/bank';
import { daysBetween, formatIsoDate, todayIn } from '../../shared/dates';
import { compareAmounts, formatMoney, parseAmountInput, subtractAmounts } from '../../shared/money';
import { deriveReferenceStatus, SUBMISSION_STATUS_META, type ReferenceStatus, type Tone } from '../../shared/status';
import { WU_DEFAULT_CONFIG, type ReferenceCreateInput } from '../../shared/schemas';
import { todayFor, type Deps } from '../deps';
import type { Queryable } from '../db/database';
import { AppError, badRequest, conflict, notFound, serviceUnavailable, unprocessable } from '../lib/errors';
import { errorFields, log } from '../lib/logger';
import { generatePaymentReference, sha256 } from '../lib/crypto';
import { recordAudit, type Actor } from './audit';
import { inList, isUniqueViolation, netPaid, requireUuid, UUID_RE, type InvoiceSummary } from './common';
import { getInvoiceForClient, getInvoiceSummary } from './invoices';
import { listNotes } from './notes';
import { brandContext, clientVisibleNotifications, invoiceContext, notifySafely } from './notifications';
import { readPublished, readPublishedGroup } from './settings';
import { getWesternUnion, listBankProfiles, listCurrencies, listMethodStates } from './paymentConfig';
import { inspectReceipt } from './receipts';

const MB = 1024 * 1024;
const OPEN_STATUSES: readonly SubmissionStatus[] = ['submitted', 'under_review', 'info_requested'];

// ---------------------------------------------------------------------------------------------
// Instruction snapshots: the exact instructions shown to the client, stored when the reference is issued.
// ---------------------------------------------------------------------------------------------

export type Requirement = 'required' | 'optional' | 'hidden';

export interface SnapshotField {
  key: string;
  label: string;
  value: string;
  sensitive: boolean;
}

export interface Requirements {
  senderName: Requirement;
  senderCountry: Requirement;
  transferReference: Requirement;
  transactionId: Requirement;
  receipt: Requirement;
}

export interface InstructionSnapshot {
  method: 'bank_transfer' | 'western_union';
  methodLabel: string;
  currency: Currency;
  amount: string;
  reference: string;
  invoiceNumber: string;
  issuedAt: string;
  bank: null | {
    profileLabel: string;
    transferType: string;
    transferTypeLabel: string;
    fields: SnapshotField[];
    additionalInstructions: string;
  };
  westernUnion: null | {
    displayName: string;
    recipientName: string;
    recipientCity: string;
    recipientCountry: string;
    instructions: string;
    additionalNotes: string;
  };
  requirements: Requirements;
  transactionIdLabel: string;
  guidance: {
    referenceInstruction: string;
    paymentDisclaimer: string;
    feesNotice: string;
    nextSteps: string;
    confirmationInstructions: string;
  };
  support: { email: string; phone: string; supportHours: string };
}

async function buildSnapshot(
  deps: Deps,
  input: {
    method: 'bank_transfer' | 'western_union';
    currency: Currency;
    amount: string;
    reference: string;
    invoiceNumber: string;
    requestedBankProfileId: string | null;
  },
): Promise<{ snapshot: InstructionSnapshot; bankProfileId: string | null }> {
  const { db } = deps;
  const settings = await readPublished(db);
  const workflow = settings.workflow;
  const base = {
    method: input.method,
    methodLabel: PAYMENT_METHOD_LABELS[input.method],
    currency: input.currency,
    amount: input.amount,
    reference: input.reference,
    invoiceNumber: input.invoiceNumber,
    issuedAt: deps.now().toISOString(),
    paymentDisclaimer: settings.policies.paymentDisclaimer,
    feesNotice: settings.policies.feesNotice,
    nextSteps: settings.policies.nextStepsText,
    confirmationInstructions: workflow.confirmationInstructions,
    support: { email: settings.contact.supportEmail, phone: settings.contact.phone, supportHours: settings.contact.supportHours },
  };

  if (input.method === 'bank_transfer') {
    const usable = (await listBankProfiles(db, input.currency)).filter((profile) => profile.enabled && !profile.archived);
    let profile = input.requestedBankProfileId ? usable.find((item) => item.id === input.requestedBankProfileId) : undefined;
    if (!profile && !input.requestedBankProfileId && usable.length === 1) profile = usable[0];
    if (!profile) {
      throw unprocessable(
        usable.length > 1 ? 'Choose a bank account for this payment.' : 'No bank account is available for this currency.',
        { bankProfileId: usable.length > 1 ? 'Choose one of the accounts shown.' : 'Not available.' },
      );
    }
    const fields: SnapshotField[] = [];
    let referenceInstruction = '';
    let additionalInstructions = '';
    for (const def of fieldsFor(input.currency, profile.transferType)) {
      const value = (profile.fields[def.key] ?? '').trim();
      if (!value) continue;
      if (def.key === 'reference_instructions') referenceInstruction = value;
      else if (def.key === 'additional_instructions') additionalInstructions = value;
      else fields.push({ key: def.key, label: def.label, value, sensitive: SENSITIVE_BANK_KEYS.includes(def.key) });
    }
    return {
      bankProfileId: profile.id,
      snapshot: {
        ...base,
        bank: {
          profileLabel: profile.label,
          transferType: profile.transferType,
          transferTypeLabel: transferTypeLabel(input.currency, profile.transferType) ?? profile.transferType,
          fields,
          additionalInstructions,
        },
        westernUnion: null,
        requirements: {
          senderName: workflow.requireSenderName ? 'required' : 'optional',
          senderCountry: 'hidden',
          transferReference: workflow.requireTransferReference ? 'required' : 'optional',
          transactionId: workflow.requireTransactionId ? 'required' : 'optional',
          receipt: workflow.requireReceipt ? 'required' : 'optional',
        },
        transactionIdLabel: 'Transaction ID',
        guidance: {
          referenceInstruction: referenceInstruction || `Include ${input.reference} as the payment reference.`,
          paymentDisclaimer: base.paymentDisclaimer,
          feesNotice: base.feesNotice,
          nextSteps: base.nextSteps,
          confirmationInstructions: base.confirmationInstructions,
        },
        support: base.support,
      },
    };
  }

  const wu = await getWesternUnion(db);
  const config = wu.config ?? WU_DEFAULT_CONFIG;
  const mtcn: Requirement =
    config.mtcnRequirement === 'required' ? 'required' : config.mtcnRequirement === 'optional' ? 'optional' : 'hidden';
  return {
    bankProfileId: null,
    snapshot: {
      ...base,
      bank: null,
      westernUnion: {
        displayName: config.displayName,
        recipientName: config.recipientName,
        recipientCity: config.recipientCity,
        recipientCountry: config.recipientCountry,
        instructions: config.instructions,
        additionalNotes: config.additionalNotes,
      },
      requirements: {
        senderName: config.requiredSenderFields.includes('sender_name') ? 'required' : 'optional',
        senderCountry: config.requiredSenderFields.includes('sender_country') ? 'required' : 'optional',
        transferReference: 'hidden',
        transactionId: mtcn,
        receipt: config.receiptRequirement === 'required' ? 'required' : 'optional',
      },
      transactionIdLabel: 'MTCN (Western Union tracking number)',
      guidance: {
        referenceInstruction: `Quote ${input.reference} as the reference when you send the money.`,
        paymentDisclaimer: base.paymentDisclaimer,
        feesNotice: base.feesNotice,
        nextSteps: base.nextSteps,
        confirmationInstructions: base.confirmationInstructions,
      },
      support: base.support,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Client: payment options for an invoice
// ---------------------------------------------------------------------------------------------

export async function paymentOptionsFor(deps: Deps, invoice: InvoiceSummary) {
  const { db } = deps;
  const currency = (await listCurrencies(db)).find((row) => row.code === invoice.currency);
  const currencyEnabled = currency?.enabled === true;
  const methods = await listMethodStates(db);
  const needsPayment =
    !['payment_verified', 'refunded', 'cancelled'].includes(invoice.status) && compareAmounts(invoice.outstanding, '0.00') > 0;
  const banks = (await listBankProfiles(db, invoice.currency)).filter((profile) => profile.enabled && !profile.archived);
  const wu = await getWesternUnion(db);
  const wuSupportsCurrency = wu.config.supportedCurrencies.includes(invoice.currency);
  const wuUsable = methods.western_union && wu.enabled && wu.ready && wuSupportsCurrency;
  const bankUsable = methods.bank_transfer && banks.length > 0;
  const base = needsPayment && currencyEnabled;

  const bankReason = base
    ? bankUsable
      ? null
      : methods.bank_transfer
        ? `No bank account is set up for ${invoice.currency} yet.`
        : 'Bank transfer is not available right now.'
    : !needsPayment
      ? 'This invoice does not currently need a payment.'
      : `Payments in ${invoice.currency} are not available right now.`;
  const wuReason = base
    ? wuUsable
      ? null
      : !wuSupportsCurrency
        ? `Western Union is not available for ${invoice.currency} invoices.`
        : 'Western Union is not available right now.'
    : bankReason;

  return {
    outstanding: invoice.outstanding,
    partialPaymentsAllowed: invoice.partialPaymentsAllowed,
    currency: {
      code: invoice.currency,
      name: currency?.name ?? invoice.currency,
      payable: currencyEnabled,
      note: `This invoice is payable only in ${invoice.currency}. Currency conversion is not offered, so pay in ${invoice.currency}.`,
    },
    methods: [
      {
        method: 'bank_transfer' as const,
        label: PAYMENT_METHOD_LABELS.bank_transfer,
        available: base && bankUsable,
        reason: bankReason,
        bankAccounts: banks.map((bank) => ({
          id: bank.id,
          label: bank.label,
          transferTypeLabel: transferTypeLabel(invoice.currency, bank.transferType) ?? bank.transferType,
        })),
      },
      {
        method: 'western_union' as const,
        label: wu.config.displayName || PAYMENT_METHOD_LABELS.western_union,
        available: base && wuUsable,
        reason: wuReason,
        bankAccounts: [] as { id: string; label: string; transferTypeLabel: string }[],
      },
      {
        // Card payments are displayed but disabled. No card data is ever collected.
        method: 'card' as const,
        label: CARD_UNAVAILABLE_LABEL,
        available: false,
        reason: CARD_UNAVAILABLE_LABEL,
        bankAccounts: [] as { id: string; label: string; transferTypeLabel: string }[],
      },
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// Client: issue a payment reference
// ---------------------------------------------------------------------------------------------

interface ReferenceRow {
  id: string;
  reference: string;
  client_id: string;
  invoice_id: string;
  method: 'bank_transfer' | 'western_union';
  currency: Currency;
  amount: string;
  status: 'issued' | 'cancelled';
  instructions_snapshot: InstructionSnapshot;
  created_at: Date;
  invoice_number: string;
}

const REFERENCE_SELECT = `
  SELECT r.id, r.reference, r.client_id, r.invoice_id, r.method, r.currency, r.amount::text AS amount, r.status,
         r.instructions_snapshot, r.created_at, i.invoice_number
    FROM payment_references r JOIN invoices i ON i.id = r.invoice_id`;

async function loadReference(db: Queryable, clientId: string, referenceId: string): Promise<ReferenceRow | null> {
  const { rows } = await db.query<ReferenceRow>(`${REFERENCE_SELECT} WHERE r.id = $1 AND r.client_id = $2`, [referenceId, clientId]);
  return rows[0] ?? null;
}

async function findReferenceByKey(db: Queryable, clientId: string, key: string): Promise<{ id: string; invoice_id: string } | null> {
  const { rows } = await db.query<{ id: string; invoice_id: string }>(
    'SELECT id, invoice_id FROM payment_references WHERE client_id = $1 AND idempotency_key = $2',
    [clientId, key],
  );
  return rows[0] ?? null;
}

async function clientEmail(db: Queryable, clientId: string): Promise<string> {
  return (await db.query<{ email: string }>('SELECT email FROM clients WHERE id = $1', [clientId])).rows[0]?.email ?? '';
}

export async function issueReference(
  deps: Deps,
  clientId: string,
  invoiceId: string,
  input: ReferenceCreateInput,
  idempotencyKey: string,
): Promise<{ reference: ClientReferenceView; created: boolean }> {
  const { db } = deps;
  const now = deps.now();
  if (!UUID_RE.test(idempotencyKey)) throw badRequest('This request could not be verified. Refresh the page and try again.');
  requireUuid(invoiceId, 'invoice');

  const replay = await findReferenceByKey(db, clientId, idempotencyKey);
  if (replay) {
    if (replay.invoice_id !== invoiceId) throw conflict('This request was already used for a different invoice.');
    return { reference: await getClientReference(deps, clientId, replay.id), created: false };
  }

  const invoice = await getInvoiceForClient(deps, clientId, invoiceId);
  if (invoice.status === 'cancelled') throw conflict('This invoice has been cancelled.');
  if (['payment_verified', 'refunded'].includes(invoice.status)) throw conflict('This invoice has already been paid.');
  if (compareAmounts(invoice.outstanding, '0.00') <= 0) throw conflict('There is nothing left to pay on this invoice.');
  if (input.currency !== invoice.currency) {
    throw unprocessable(`This invoice is payable only in ${invoice.currency}. Currency conversion is not offered.`, {
      currency: `Choose ${invoice.currency}.`,
    });
  }
  if (input.method === 'card') throw unprocessable(CARD_UNAVAILABLE_LABEL, { method: CARD_UNAVAILABLE_LABEL });
  const method: 'bank_transfer' | 'western_union' = input.method;

  const currency = (await listCurrencies(db)).find((row) => row.code === invoice.currency);
  if (!currency?.enabled) throw unprocessable(`Payments in ${invoice.currency} are not available right now.`, { currency: 'Not available.' });
  const methods = await listMethodStates(db);
  if (!methods[method as PaymentMethod]) {
    throw unprocessable('This payment method is not available right now.', { method: 'Choose another method.' });
  }

  // The server decides the amount. A requested partial amount is honoured only when the invoice allows it.
  let amount = invoice.outstanding;
  const requested = input.amount?.trim();
  if (requested) {
    const parsed = parseAmountInput(requested);
    if (!parsed) throw unprocessable('Enter an amount with up to 2 decimal places.', { amount: 'Invalid amount.' });
    if (compareAmounts(parsed, invoice.outstanding) > 0) {
      throw unprocessable(`The amount cannot be more than the outstanding balance of ${formatMoney(invoice.outstanding, invoice.currency)}.`, {
        amount: 'Too high.',
      });
    }
    if (!invoice.partialPaymentsAllowed && compareAmounts(parsed, invoice.outstanding) !== 0) {
      throw unprocessable(`Partial payments are not allowed on this invoice. Pay the full balance of ${formatMoney(invoice.outstanding, invoice.currency)}.`, {
        amount: 'Pay the full balance.',
      });
    }
    if (compareAmounts(parsed, '0.00') <= 0) throw unprocessable('The amount must be greater than zero.', { amount: 'Too low.' });
    amount = parsed;
  }

  const ops = await readPublishedGroup(db, 'operations');
  const brand = await brandContext(deps);
  const today = todayFor(deps);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const reference = generatePaymentReference(ops.referencePrefix, today);
    const built = await buildSnapshot(deps, {
      method,
      currency: invoice.currency,
      amount,
      reference,
      invoiceNumber: invoice.invoiceNumber,
      requestedBankProfileId: input.bankProfileId ?? null,
    });
    try {
      const referenceId = await db.transaction(async (tx) => {
        // Lock the invoice so two concurrent requests cannot both claim the same outstanding balance.
        const locked = await tx.query<{ total_amount: string }>(
          'SELECT total_amount::text AS total_amount FROM invoices WHERE id = $1 FOR UPDATE',
          [invoiceId],
        );
        if (!locked.rows[0]) throw notFound('We could not find that invoice.');
        const outstandingNow = subtractAmounts(locked.rows[0].total_amount, await netPaid(tx, invoiceId));
        if (compareAmounts(amount, outstandingNow) > 0) {
          throw conflict('The outstanding balance has changed. Refresh the invoice and try again.');
        }
        const inserted = await tx.query<{ id: string }>(
          `INSERT INTO payment_references (reference, client_id, invoice_id, method, currency, amount, bank_profile_id,
                                           instructions_snapshot, status, idempotency_key, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'issued', $9, $10)
           RETURNING id`,
          [reference, clientId, invoiceId, method, invoice.currency, amount, built.bankProfileId, JSON.stringify(built.snapshot), idempotencyKey, now],
        );
        await recordAudit(
          tx,
          { type: 'client', id: clientId },
          {
            action: 'payment.reference_issued',
            summary: `Issued ${reference} for ${invoice.invoiceNumber}`,
            entityType: 'payment_reference',
            entityId: inserted.rows[0].id,
            metadata: { method, currency: invoice.currency, amount, invoiceNumber: invoice.invoiceNumber },
          },
          now,
        );
        return inserted.rows[0].id;
      });
      await notifySafely(deps, {
        templateKey: 'payment_instructions_issued',
        recipient: { type: 'client', clientId, address: await clientEmail(db, clientId) },
        context: { ...invoiceContext(brand, invoice, amount), reference },
        dedupeKey: `instructions:${referenceId}`,
        invoiceId,
      });
      return { reference: await getClientReference(deps, clientId, referenceId), created: true };
    } catch (error) {
      if (isUniqueViolation(error, 'payment_references_reference_key')) continue;
      if (isUniqueViolation(error, 'payment_references_client_id_idempotency_key_key')) {
        const existing = await findReferenceByKey(db, clientId, idempotencyKey);
        if (existing) return { reference: await getClientReference(deps, clientId, existing.id), created: false };
      }
      throw error;
    }
  }
  log('error', 'payment.reference_collision');
  throw serviceUnavailable('We could not issue a payment reference. Please try again.');
}

// ---------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------

export interface ReceiptView {
  id: string;
  originalName: string;
  contentType: string;
  byteSize: number;
  uploadedAt: string;
}

interface SubmissionRow {
  id: string;
  reference_id: string;
  invoice_id: string;
  client_id: string;
  attempt_no: number;
  status: SubmissionStatus;
  method: string;
  currency: Currency;
  amount_sent: string;
  sent_on: string;
  sender_name: string;
  sender_country: string;
  transfer_reference: string;
  transaction_id: string;
  client_note: string;
  verified_amount: string | null;
  verified_at: Date | null;
  rejection_reason: string | null;
  info_request: string | null;
  reviewed_at: Date | null;
  created_at: Date;
}

export interface ClientSubmissionView {
  id: string;
  attemptNo: number;
  status: SubmissionStatus;
  statusLabel: string;
  tone: Tone;
  amountSent: string;
  amountSentFormatted: string;
  sentOn: string;
  senderName: string;
  senderCountry: string;
  transferReference: string;
  transactionId: string;
  clientNote: string;
  submittedAt: string;
  reviewedAt: string | null;
  verifiedAmount: string | null;
  verifiedAmountFormatted: string | null;
  rejectionReason: string | null;
  infoRequest: string | null;
  receipts: ReceiptView[];
  timeline: { status: SubmissionStatus; label: string; at: string }[];
}

export interface ClientReferenceView {
  id: string;
  reference: string;
  invoiceId: string;
  invoiceNumber: string;
  method: 'bank_transfer' | 'western_union';
  methodLabel: string;
  currency: Currency;
  amount: string;
  amountFormatted: string;
  status: ReferenceStatus;
  statusLabel: string;
  tone: Tone;
  issuedAt: string;
  instructions: InstructionSnapshot;
  submissions: ClientSubmissionView[];
  canSubmitConfirmation: boolean;
  confirmationBlockedReason: string | null;
}

function iso(value: Date | string | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

async function loadBundles(db: Queryable, referenceIds: string[]) {
  const empty = {
    submissions: [] as SubmissionRow[],
    receipts: [] as (ReceiptView & { submissionId: string })[],
    history: [] as { submission_id: string; to_status: SubmissionStatus; created_at: Date }[],
  };
  if (referenceIds.length === 0) return empty;
  const refs = inList(referenceIds);
  const submissions = await db.query<SubmissionRow>(
    `SELECT id, reference_id, invoice_id, client_id, attempt_no, status, method, currency,
            amount_sent::text AS amount_sent, sent_on::text AS sent_on, sender_name, sender_country,
            transfer_reference, transaction_id, client_note, verified_amount::text AS verified_amount,
            verified_at, rejection_reason, info_request, reviewed_at, created_at
       FROM payment_submissions WHERE reference_id IN (${refs.sql}) ORDER BY reference_id, attempt_no`,
    refs.params,
  );
  if (submissions.rows.length === 0) return { ...empty, submissions: submissions.rows };
  const subs = inList(submissions.rows.map((row) => row.id));
  const receipts = await db.query<{
    id: string;
    submission_id: string;
    original_name: string;
    content_type: string;
    byte_size: number;
    uploaded_at: Date;
  }>(
    `SELECT id, submission_id, original_name, content_type, byte_size, uploaded_at
       FROM receipts WHERE submission_id IN (${subs.sql}) ORDER BY uploaded_at`,
    subs.params,
  );
  const history = await db.query<{ submission_id: string; to_status: SubmissionStatus; created_at: Date }>(
    `SELECT submission_id, to_status, created_at FROM submission_status_history WHERE submission_id IN (${subs.sql}) ORDER BY id`,
    subs.params,
  );
  return {
    submissions: submissions.rows,
    receipts: receipts.rows.map((row) => ({
      id: row.id,
      submissionId: row.submission_id,
      originalName: row.original_name,
      contentType: row.content_type,
      byteSize: row.byte_size,
      uploadedAt: new Date(row.uploaded_at).toISOString(),
    })),
    history: history.rows,
  };
}

function buildClientReference(row: ReferenceRow, bundle: Awaited<ReturnType<typeof loadBundles>>): ClientReferenceView {
  const subs = bundle.submissions.filter((sub) => sub.reference_id === row.id);
  const latest = subs.at(-1) ?? null;
  const status = deriveReferenceStatus(row.status === 'cancelled', latest?.status ?? null);
  const hasOpen = subs.some((sub) => OPEN_STATUSES.includes(sub.status));
  const submissions: ClientSubmissionView[] = subs.map((sub) => {
    const meta = SUBMISSION_STATUS_META[sub.status];
    const steps = bundle.history.filter((item) => item.submission_id === sub.id);
    return {
      id: sub.id,
      attemptNo: sub.attempt_no,
      status: sub.status,
      statusLabel: meta.label,
      tone: meta.tone,
      amountSent: sub.amount_sent,
      amountSentFormatted: formatMoney(sub.amount_sent, sub.currency),
      sentOn: sub.sent_on,
      senderName: sub.sender_name,
      senderCountry: sub.sender_country,
      transferReference: sub.transfer_reference,
      transactionId: sub.transaction_id,
      clientNote: sub.client_note,
      submittedAt: iso(sub.created_at) as string,
      reviewedAt: iso(sub.reviewed_at),
      verifiedAmount: sub.status === 'verified' ? sub.verified_amount : null,
      verifiedAmountFormatted: sub.status === 'verified' && sub.verified_amount ? formatMoney(sub.verified_amount, sub.currency) : null,
      rejectionReason: sub.status === 'rejected' ? sub.rejection_reason : null,
      infoRequest: sub.status === 'info_requested' ? sub.info_request : null,
      receipts: bundle.receipts
        .filter((receipt) => receipt.submissionId === sub.id)
        .map((receipt) => ({
          id: receipt.id,
          originalName: receipt.originalName,
          contentType: receipt.contentType,
          byteSize: receipt.byteSize,
          uploadedAt: receipt.uploadedAt,
        })),
      timeline:
        steps.length > 0
          ? steps.map((step) => ({ status: step.to_status, label: SUBMISSION_STATUS_META[step.to_status].label, at: iso(step.created_at) as string }))
          : [{ status: 'submitted' as const, label: SUBMISSION_STATUS_META.submitted.label, at: iso(sub.created_at) as string }],
    };
  });

  let blocked: string | null = null;
  if (row.status === 'cancelled') blocked = 'This payment reference has been cancelled.';
  else if (hasOpen && latest && ['submitted', 'under_review'].includes(latest.status)) {
    blocked = 'A confirmation for this payment is already being reviewed. You will be notified when there is an update.';
  } else if (latest?.status === 'verified') blocked = 'This payment has already been verified.';
  const canSubmit = blocked === null && ['awaiting_payment', 'rejected', 'info_requested'].includes(status.status);

  return {
    id: row.id,
    reference: row.reference,
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number,
    method: row.method,
    methodLabel: PAYMENT_METHOD_LABELS[row.method],
    currency: row.currency,
    amount: row.amount,
    amountFormatted: formatMoney(row.amount, row.currency),
    status: status.status,
    statusLabel: status.label,
    tone: status.tone,
    issuedAt: iso(row.created_at) as string,
    instructions: row.instructions_snapshot,
    submissions,
    canSubmitConfirmation: canSubmit,
    confirmationBlockedReason: blocked,
  };
}

export async function getClientReference(deps: Deps, clientId: string, referenceId: string): Promise<ClientReferenceView> {
  const row = await loadReference(deps.db, clientId, requireUuid(referenceId, 'payment reference'));
  if (!row) throw notFound('We could not find that payment reference.');
  return buildClientReference(row, await loadBundles(deps.db, [row.id]));
}

export async function listClientReferences(deps: Deps, clientId: string, invoiceId?: string): Promise<ClientReferenceView[]> {
  const params: unknown[] = [clientId];
  let where = 'r.client_id = $1';
  if (invoiceId) {
    params.push(requireUuid(invoiceId, 'invoice'));
    where += ' AND r.invoice_id = $2';
  }
  const { rows } = await deps.db.query<ReferenceRow>(`${REFERENCE_SELECT} WHERE ${where} ORDER BY r.created_at DESC LIMIT 200`, params);
  const bundle = await loadBundles(
    deps.db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => buildClientReference(row, bundle));
}

// ---------------------------------------------------------------------------------------------
// Client: submit a confirmation
// ---------------------------------------------------------------------------------------------

export interface SubmissionUpload {
  bytes: Uint8Array;
  declaredType: string | null;
  name: string;
}

export async function submitConfirmation(
  deps: Deps,
  clientId: string,
  referenceId: string,
  fields: Record<string, string>,
  file: SubmissionUpload | null,
  idempotencyKey: string,
): Promise<{ reference: ClientReferenceView; submissionId: string; replayed: boolean }> {
  const { db, config, storage } = deps;
  const now = deps.now();
  if (!UUID_RE.test(idempotencyKey)) throw badRequest('This request could not be verified. Refresh the page and try again.');
  requireUuid(referenceId, 'payment reference');

  const replayed = await db.query<{ id: string; reference_id: string }>(
    'SELECT id, reference_id FROM payment_submissions WHERE client_id = $1 AND idempotency_key = $2',
    [clientId, idempotencyKey],
  );
  if (replayed.rows[0]) {
    if (replayed.rows[0].reference_id !== referenceId) throw conflict('This request was already used for a different payment.');
    return { reference: await getClientReference(deps, clientId, referenceId), submissionId: replayed.rows[0].id, replayed: true };
  }

  const row = await loadReference(db, clientId, referenceId);
  if (!row) throw notFound('We could not find that payment reference.');
  if (row.status !== 'issued') throw conflict('This payment reference is no longer open.');
  const invoice = await getInvoiceSummary(deps, row.invoice_id);
  if (['payment_verified', 'refunded', 'cancelled'].includes(invoice.status)) {
    throw conflict('This invoice no longer needs a payment confirmation.');
  }
  const current = await getClientReference(deps, clientId, referenceId);
  if (!current.canSubmitConfirmation) {
    throw conflict(current.confirmationBlockedReason ?? 'A new confirmation cannot be sent for this payment right now.');
  }

  const req = row.instructions_snapshot.requirements;
  const value = (key: string) => (typeof fields[key] === 'string' ? fields[key].trim() : '');
  const errors: Record<string, string> = {};
  const amountSent = parseAmountInput(value('amountSent'));
  const sentOn = value('sentOn');
  const senderName = value('senderName');
  const senderCountry = value('senderCountry').toUpperCase();
  const transferReference = value('transferReference');
  const transactionId = value('transactionId');
  const note = value('note');

  if (value('currency') !== row.currency) errors.currency = `Confirm the currency: this payment is in ${row.currency}.`;
  if (value('method') !== row.method) errors.method = 'This does not match the payment method on the reference.';
  if (!amountSent || compareAmounts(amountSent, '0.00') <= 0) errors.amountSent = 'Enter the amount you sent, for example 1250.00.';
  else if (compareAmounts(amountSent, row.amount) > 0) errors.amountSent = `The amount cannot be more than ${formatMoney(row.amount, row.currency)}.`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sentOn)) errors.sentOn = 'Enter the date you sent the money.';
  else if (sentOn > todayFor(deps)) errors.sentOn = 'The date sent cannot be in the future.';
  if (req.senderName === 'required' && !senderName) errors.senderName = 'Enter the name of the sender.';
  if (senderName.length > 120) errors.senderName = 'Use at most 120 characters.';
  if (req.senderCountry === 'required' && !/^[A-Z]{2}$/.test(senderCountry)) errors.senderCountry = 'Choose the country the money was sent from.';
  if (req.transferReference === 'required' && !transferReference) errors.transferReference = 'Enter the transfer reference from your bank record.';
  if (transferReference.length > 120) errors.transferReference = 'Use at most 120 characters.';
  if (req.transactionId === 'required' && !transactionId) errors.transactionId = 'Enter the transaction ID.';
  if (transactionId.length > 120) errors.transactionId = 'Use at most 120 characters.';
  if (note.length > 1000) errors.note = 'Use at most 1000 characters.';

  const workflow = await readPublishedGroup(db, 'workflow');
  const maxBytes = Math.min(config.receiptMaxBytes, workflow.maxReceiptMegabytes * MB);
  let receipt: { bytes: Uint8Array; contentType: string; extension: 'pdf' | 'jpg' | 'png'; name: string; sha256: string } | null = null;
  if (file) {
    try {
      const info = inspectReceipt(file.bytes, file.declaredType, maxBytes);
      receipt = { bytes: file.bytes, contentType: info.contentType, extension: info.extension, name: file.name, sha256: sha256(file.bytes) };
    } catch (error) {
      if (error instanceof AppError && error.details) Object.assign(errors, error.details);
      else throw error;
    }
  } else if (req.receipt === 'required') {
    errors.receipt = 'Upload your receipt or proof of transfer.';
  }
  if (Object.keys(errors).length > 0) throw unprocessable('Please correct the highlighted fields.', errors);

  const submissionId = randomUUID();
  const receiptId = randomUUID();
  const storageKey = receipt ? `receipts/${new Date(now).getUTCFullYear()}/${submissionId}/${receiptId}.${receipt.extension}` : null;
  if (receipt && storageKey) {
    try {
      await storage.put(storageKey, receipt.bytes, receipt.contentType);
    } catch (error) {
      log('error', 'receipt.storage_put_failed', errorFields(error));
      throw serviceUnavailable('We could not store your receipt, so nothing was submitted. Please try again in a moment.');
    }
  }

  try {
    await db.transaction(async (tx) => {
      const locked = await tx.query<{ status: string }>('SELECT status FROM payment_references WHERE id = $1 FOR UPDATE', [row.id]);
      if (locked.rows[0]?.status !== 'issued') throw conflict('This payment reference is no longer open.');
      const open = await tx.query(
        `SELECT 1 FROM payment_submissions WHERE reference_id = $1 AND status IN ('submitted', 'under_review') LIMIT 1`,
        [row.id],
      );
      if (open.rowCount > 0) throw conflict('A confirmation for this payment is already being reviewed.');
      // A replacement closes any open information request, so only one thread is ever active.
      const stale = await tx.query<{ id: string }>(
        `SELECT id FROM payment_submissions WHERE reference_id = $1 AND status = 'info_requested'`,
        [row.id],
      );
      for (const item of stale.rows) {
        await tx.query(`UPDATE payment_submissions SET status = 'superseded', updated_at = $2 WHERE id = $1`, [item.id, now]);
        await tx.query(
          `INSERT INTO submission_status_history (submission_id, from_status, to_status, actor_type, actor_id, note, created_at)
           VALUES ($1, 'info_requested', 'superseded', 'client', $2, 'Replaced by a newer confirmation', $3)`,
          [item.id, clientId, now],
        );
      }
      const attempt = await tx.query<{ next: number }>(
        'SELECT (COALESCE(MAX(attempt_no), 0) + 1)::int AS next FROM payment_submissions WHERE reference_id = $1',
        [row.id],
      );
      await tx.query(
        `INSERT INTO payment_submissions
           (id, reference_id, invoice_id, client_id, attempt_no, status, method, currency, amount_sent, sent_on,
            sender_name, sender_country, transfer_reference, transaction_id, client_note, idempotency_key,
            created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'submitted', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16)`,
        [
          submissionId,
          row.id,
          row.invoice_id,
          clientId,
          attempt.rows[0].next,
          row.method,
          row.currency,
          amountSent,
          sentOn,
          senderName,
          senderCountry,
          transferReference,
          transactionId,
          note,
          idempotencyKey,
          now,
        ],
      );
      await tx.query(
        `INSERT INTO submission_status_history (submission_id, from_status, to_status, actor_type, actor_id, note, created_at)
         VALUES ($1, NULL, 'submitted', 'client', $2, '', $3)`,
        [submissionId, clientId, now],
      );
      if (receipt && storageKey) {
        await tx.query(
          `INSERT INTO receipts (id, submission_id, storage_driver, storage_key, original_name, content_type, byte_size, sha256, uploaded_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [receiptId, submissionId, storage.driver, storageKey, receipt.name, receipt.contentType, receipt.bytes.length, receipt.sha256, now],
        );
      }
      await recordAudit(
        tx,
        { type: 'client', id: clientId },
        {
          action: 'payment.confirmation_submitted',
          summary: `Confirmation submitted for ${row.reference}`,
          entityType: 'payment_submission',
          entityId: submissionId,
          metadata: { reference: row.reference, amountSent, currency: row.currency, receiptAttached: Boolean(receipt) },
        },
        now,
      );
    });
  } catch (error) {
    if (storageKey) {
      await storage.remove(storageKey).catch((cleanupError: unknown) => log('warn', 'receipt.cleanup_failed', errorFields(cleanupError)));
    }
    if (isUniqueViolation(error, 'payment_submissions_client_id_idempotency_key_key')) {
      const again = await db.query<{ id: string }>('SELECT id FROM payment_submissions WHERE client_id = $1 AND idempotency_key = $2', [
        clientId,
        idempotencyKey,
      ]);
      if (again.rows[0]) {
        return { reference: await getClientReference(deps, clientId, referenceId), submissionId: again.rows[0].id, replayed: true };
      }
    }
    throw error;
  }

  // Notifications are best-effort. The confirmation is already stored and must not be reported as failed.
  const brand = await brandContext(deps);
  await notifySafely(deps, {
    templateKey: 'confirmation_submitted',
    recipient: { type: 'client', clientId, address: await clientEmail(db, clientId) },
    context: { ...invoiceContext(brand, invoice, amountSent as string), reference: row.reference },
    dedupeKey: `confirm:${submissionId}`,
    invoiceId: row.invoice_id,
    submissionId,
  });
  const settings = await readPublished(db);
  if (settings.workflow.notifyAdminOnSubmission && settings.contact.supportEmail) {
    await notifySafely(deps, {
      templateKey: 'receipt_uploaded',
      recipient: { type: 'admin', address: settings.contact.supportEmail },
      context: {
        agencyName: brand.agencyName,
        clientName: invoice.clientName,
        clientCode: invoice.clientCode,
        invoiceNumber: invoice.invoiceNumber,
        reference: row.reference,
        amount: formatMoney(amountSent as string, row.currency),
        receiptStatus: receipt ? 'Attached' : 'Not attached',
      },
      dedupeKey: `admin-submission:${submissionId}`,
      invoiceId: row.invoice_id,
      submissionId,
    });
  }
  return { reference: await getClientReference(deps, clientId, referenceId), submissionId, replayed: false };
}

// ---------------------------------------------------------------------------------------------
// Receipts: authorised lookup. Callers pass the scope they have already checked.
// ---------------------------------------------------------------------------------------------

export async function receiptForAccess(
  db: Queryable,
  receiptId: string,
  scope: { clientId: string } | { admin: true },
): Promise<{ storageKey: string; contentType: string; originalName: string } | null> {
  const params: unknown[] = [requireUuid(receiptId, 'receipt')];
  let where = 'r.id = $1';
  if ('clientId' in scope) {
    params.push(scope.clientId);
    where += ' AND s.client_id = $2';
  }
  const { rows } = await db.query<{ storage_key: string; content_type: string; original_name: string }>(
    `SELECT r.storage_key, r.content_type, r.original_name
       FROM receipts r JOIN payment_submissions s ON s.id = r.submission_id WHERE ${where}`,
    params,
  );
  const row = rows[0];
  return row ? { storageKey: row.storage_key, contentType: row.content_type, originalName: row.original_name } : null;
}

// ---------------------------------------------------------------------------------------------
// Admin: review queue
// ---------------------------------------------------------------------------------------------

export async function listSubmissions(deps: Deps, filter: { status?: string; q?: string }) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (!filter.status || filter.status === 'queue') {
    where.push(`s.status IN ('submitted', 'under_review', 'info_requested')`);
  } else if (filter.status !== 'all') {
    params.push(filter.status);
    where.push(`s.status = $${params.length}`);
  }
  if (filter.q) {
    const pattern = `%${filter.q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    params.push(pattern);
    const at = params.length;
    where.push(`(r.reference ILIKE $${at} OR c.full_name ILIKE $${at} OR c.client_code ILIKE $${at} OR i.invoice_number ILIKE $${at})`);
  }
  const { rows } = await deps.db.query<{
    id: string;
    status: SubmissionStatus;
    method: string;
    currency: Currency;
    amount_sent: string;
    sent_on: string;
    created_at: Date;
    reference: string;
    invoice_number: string;
    invoice_id: string;
    client_name: string;
    client_code: string;
    receipt_count: number;
    attempt_no: number;
  }>(
    `SELECT s.id, s.status, s.method, s.currency, s.amount_sent::text AS amount_sent, s.sent_on::text AS sent_on,
            s.created_at, s.attempt_no, r.reference, i.invoice_number, i.id AS invoice_id,
            c.full_name AS client_name, c.client_code,
            (SELECT COUNT(*)::int FROM receipts rc WHERE rc.submission_id = s.id) AS receipt_count
       FROM payment_submissions s
       JOIN payment_references r ON r.id = s.reference_id
       JOIN invoices i ON i.id = s.invoice_id
       JOIN clients c ON c.id = s.client_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY s.created_at ASC LIMIT 200`,
    params,
  );
  const today = todayFor(deps);
  return rows.map((row) => {
    const meta = SUBMISSION_STATUS_META[row.status];
    const submittedOn = todayIn(deps.config.timeZone, new Date(row.created_at));
    return {
      id: row.id,
      status: row.status,
      statusLabel: meta.label,
      tone: meta.tone,
      method: row.method,
      methodLabel: PAYMENT_METHOD_LABELS[row.method as PaymentMethod] ?? row.method,
      currency: row.currency,
      amountSent: row.amount_sent,
      amountSentFormatted: formatMoney(row.amount_sent, row.currency),
      sentOn: row.sent_on,
      sentOnFormatted: formatIsoDate(row.sent_on),
      submittedAt: new Date(row.created_at).toISOString(),
      waitingDays: Math.max(0, daysBetween(submittedOn, today)),
      reference: row.reference,
      invoiceId: row.invoice_id,
      invoiceNumber: row.invoice_number,
      clientName: row.client_name,
      clientCode: row.client_code,
      receiptCount: row.receipt_count,
      attemptNo: row.attempt_no,
    };
  });
}

export async function submissionDetail(deps: Deps, id: string) {
  const { db } = deps;
  requireUuid(id, 'submission');
  const { rows } = await db.query<SubmissionRow & {
    reference: string;
    invoice_number: string;
    client_name: string;
    client_code: string;
    instructions_snapshot: InstructionSnapshot;
    reviewer_name: string | null;
    verifier_name: string | null;
    verified_by_id: string | null;
  }>(
    `SELECT s.id, s.reference_id, s.invoice_id, s.client_id, s.attempt_no, s.status, s.method, s.currency,
            s.amount_sent::text AS amount_sent, s.sent_on::text AS sent_on, s.sender_name, s.sender_country,
            s.transfer_reference, s.transaction_id, s.client_note, s.verified_amount::text AS verified_amount,
            s.verified_at, s.rejection_reason, s.info_request, s.reviewed_at, s.created_at,
            r.reference, r.instructions_snapshot, i.invoice_number, c.full_name AS client_name, c.client_code,
            rv.display_name AS reviewer_name, vf.display_name AS verifier_name, s.verified_by AS verified_by_id
       FROM payment_submissions s
       JOIN payment_references r ON r.id = s.reference_id
       JOIN invoices i ON i.id = s.invoice_id
       JOIN clients c ON c.id = s.client_id
       LEFT JOIN admin_users rv ON rv.id = s.reviewed_by
       LEFT JOIN admin_users vf ON vf.id = s.verified_by
      WHERE s.id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw notFound('That confirmation does not exist.');
  const receipts = await db.query<{
    id: string;
    original_name: string;
    content_type: string;
    byte_size: number;
    sha256: string;
    uploaded_at: Date;
    storage_driver: string;
  }>(
    `SELECT id, original_name, content_type, byte_size, sha256, uploaded_at, storage_driver
       FROM receipts WHERE submission_id = $1 ORDER BY uploaded_at`,
    [id],
  );
  const history = await db.query<{ from_status: string | null; to_status: string; actor_type: string; note: string; created_at: Date }>(
    `SELECT from_status, to_status, actor_type, note, created_at FROM submission_status_history WHERE submission_id = $1 ORDER BY id`,
    [id],
  );
  const invoice = await getInvoiceSummary(deps, row.invoice_id);
  const meta = SUBMISSION_STATUS_META[row.status];
  return {
    id: row.id,
    referenceId: row.reference_id,
    invoiceId: row.invoice_id,
    reference: row.reference,
    invoiceNumber: row.invoice_number,
    invoice,
    client: { id: row.client_id, name: row.client_name, code: row.client_code },
    attemptNo: row.attempt_no,
    status: row.status,
    statusLabel: meta.label,
    tone: meta.tone,
    method: row.method,
    methodLabel: PAYMENT_METHOD_LABELS[row.method as PaymentMethod] ?? row.method,
    currency: row.currency,
    amountSent: row.amount_sent,
    amountSentFormatted: formatMoney(row.amount_sent, row.currency),
    referenceAmount: row.instructions_snapshot.amount,
    sentOn: row.sent_on,
    senderName: row.sender_name,
    senderCountry: row.sender_country,
    transferReference: row.transfer_reference,
    transactionId: row.transaction_id,
    clientNote: row.client_note,
    submittedAt: new Date(row.created_at).toISOString(),
    verifiedAmount: row.verified_amount,
    verifiedAt: iso(row.verified_at),
    verifiedBy: row.verifier_name,
    reviewedAt: iso(row.reviewed_at),
    reviewedBy: row.reviewer_name,
    rejectionReason: row.rejection_reason,
    infoRequest: row.info_request,
    instructions: row.instructions_snapshot,
    receipts: receipts.rows.map((item) => ({
      id: item.id,
      originalName: item.original_name,
      contentType: item.content_type,
      byteSize: item.byte_size,
      sha256: item.sha256,
      uploadedAt: new Date(item.uploaded_at).toISOString(),
      storageDriver: item.storage_driver,
    })),
    history: history.rows.map((item) => ({
      from: item.from_status,
      to: item.to_status,
      label: SUBMISSION_STATUS_META[item.to_status as SubmissionStatus]?.label ?? item.to_status,
      actorType: item.actor_type,
      note: item.note,
      at: new Date(item.created_at).toISOString(),
    })),
    notes: await listNotes(db, 'submission', id),
    clientNotifications: await clientVisibleNotifications(db, row.client_id),
    netPaid: await netPaid(db, row.invoice_id),
  };
}

// ---------------------------------------------------------------------------------------------
// Admin: review actions. Each action locks the submission row and checks the state it expects.
// ---------------------------------------------------------------------------------------------

interface LockedSubmission {
  id: string;
  invoice_id: string;
  client_id: string;
  status: SubmissionStatus;
  currency: Currency;
  amount_sent: string;
  reference_id: string;
  reference: string;
}

async function lockSubmission(tx: Queryable, id: string): Promise<LockedSubmission> {
  const { rows } = await tx.query<LockedSubmission>(
    `SELECT s.id, s.invoice_id, s.client_id, s.status, s.currency, s.amount_sent::text AS amount_sent,
            s.reference_id, r.reference
       FROM payment_submissions s JOIN payment_references r ON r.id = s.reference_id
      WHERE s.id = $1 FOR UPDATE OF s`,
    [requireUuid(id, 'submission')],
  );
  if (!rows[0]) throw notFound('That confirmation does not exist.');
  return rows[0];
}

function assertOpen(sub: LockedSubmission): void {
  if (!OPEN_STATUSES.includes(sub.status)) {
    throw conflict(`This confirmation is already ${SUBMISSION_STATUS_META[sub.status].label.toLowerCase()} and cannot be changed.`);
  }
}

async function recordStep(tx: Queryable, sub: LockedSubmission, to: SubmissionStatus, actor: Actor, note: string, now: Date) {
  await tx.query(
    `INSERT INTO submission_status_history (submission_id, from_status, to_status, actor_type, actor_id, note, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [sub.id, sub.status, to, actor.type, actor.id, note, now],
  );
}

export async function startReview(deps: Deps, id: string, actor: Actor): Promise<void> {
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    const sub = await lockSubmission(tx, id);
    if (sub.status !== 'submitted') return;
    await tx.query(
      `UPDATE payment_submissions SET status = 'under_review', reviewed_by = $2, reviewed_at = $3, updated_at = $3 WHERE id = $1`,
      [id, actor.id, now],
    );
    await recordStep(tx, sub, 'under_review', actor, '', now);
    await recordAudit(tx, actor, { action: 'payment.review_started', summary: `Started review of ${sub.reference}`, entityType: 'payment_submission', entityId: id }, now);
  });
}

export async function requestMoreInformation(deps: Deps, id: string, message: string, actor: Actor): Promise<void> {
  const now = deps.now();
  const sub = await deps.db.transaction(async (tx) => {
    const locked = await lockSubmission(tx, id);
    assertOpen(locked);
    await tx.query(
      `UPDATE payment_submissions SET status = 'info_requested', info_request = $2, reviewed_by = $3, reviewed_at = $4, updated_at = $4 WHERE id = $1`,
      [id, message, actor.id, now],
    );
    await recordStep(tx, locked, 'info_requested', actor, message, now);
    await recordAudit(tx, actor, { action: 'payment.info_requested', summary: `Requested more information for ${locked.reference}`, entityType: 'payment_submission', entityId: id }, now);
    return locked;
  });
  await notifyClientAbout(deps, sub, 'info_requested', { message });
}

export async function rejectConfirmation(deps: Deps, id: string, reason: string, actor: Actor): Promise<void> {
  const now = deps.now();
  const sub = await deps.db.transaction(async (tx) => {
    const locked = await lockSubmission(tx, id);
    assertOpen(locked);
    await tx.query(
      `UPDATE payment_submissions SET status = 'rejected', rejection_reason = $2, reviewed_by = $3, reviewed_at = $4, updated_at = $4 WHERE id = $1`,
      [id, reason, actor.id, now],
    );
    await recordStep(tx, locked, 'rejected', actor, reason, now);
    await recordAudit(tx, actor, { action: 'payment.rejected', summary: `Rejected confirmation for ${locked.reference}`, entityType: 'payment_submission', entityId: id, metadata: { reason } }, now);
    return locked;
  });
  await notifyClientAbout(deps, sub, 'payment_rejected', { reason });
}

export async function verifyConfirmation(
  deps: Deps,
  id: string,
  input: { verifiedAmount: string; note: string },
  actor: Actor,
): Promise<{ verifiedAmount: string; invoiceStatus: string; remaining: string }> {
  const now = deps.now();
  const verifiedAmount = parseAmountInput(input.verifiedAmount);
  if (!verifiedAmount) throw unprocessable('Enter the verified amount.', { verifiedAmount: 'Invalid amount.' });
  const result = await deps.db.transaction(async (tx) => {
    const sub = await lockSubmission(tx, id);
    assertOpen(sub);
    const invRows = await tx.query<{ total_amount: string; status: string; currency: Currency; partial_payments_allowed: boolean; invoice_number: string }>(
      `SELECT total_amount::text AS total_amount, status, currency, partial_payments_allowed, invoice_number
         FROM invoices WHERE id = $1 FOR UPDATE`,
      [sub.invoice_id],
    );
    const inv = invRows.rows[0];
    if (!inv) throw notFound('The invoice for this confirmation does not exist.');
    if (inv.status === 'cancelled') throw conflict('This invoice has been cancelled, so the payment cannot be verified against it.');
    if (inv.currency !== sub.currency) throw conflict('The payment currency does not match the invoice currency.');
    const outstanding = subtractAmounts(inv.total_amount, await netPaid(tx, sub.invoice_id));
    if (compareAmounts(outstanding, '0.00') <= 0) throw conflict('This invoice is already fully paid.');
    if (compareAmounts(verifiedAmount, '0.00') <= 0) throw unprocessable('The verified amount must be greater than zero.', { verifiedAmount: 'Too low.' });
    if (compareAmounts(verifiedAmount, outstanding) > 0) {
      throw unprocessable(`The verified amount cannot be more than the outstanding balance of ${formatMoney(outstanding, inv.currency)}.`, {
        verifiedAmount: 'Too high.',
      });
    }
    if (!inv.partial_payments_allowed && compareAmounts(verifiedAmount, outstanding) !== 0) {
      throw unprocessable(
        'This invoice does not allow partial payments. Verify the full outstanding balance, or request more information or reject the confirmation.',
        { verifiedAmount: `Must equal ${formatMoney(outstanding, inv.currency)}.` },
      );
    }
    await tx.query(
      `UPDATE payment_submissions
          SET status = 'verified', verified_amount = $2, verified_at = $3, verified_by = $4,
              reviewed_by = COALESCE(reviewed_by, $4), reviewed_at = $3, updated_at = $3
        WHERE id = $1`,
      [id, verifiedAmount, now, actor.id],
    );
    await recordStep(tx, sub, 'verified', actor, input.note, now);
    await tx.query(
      `INSERT INTO payment_ledger (invoice_id, submission_id, kind, amount, currency, reference_note, recorded_by, recorded_at)
       VALUES ($1, $2, 'verified_payment', $3, $4, $5, $6, $7)`,
      [sub.invoice_id, id, verifiedAmount, inv.currency, input.note, actor.id, now],
    );
    const remaining = subtractAmounts(inv.total_amount, await netPaid(tx, sub.invoice_id));
    await recordAudit(
      tx,
      actor,
      {
        action: 'payment.verified',
        summary: `Verified ${formatMoney(verifiedAmount, inv.currency)} for ${inv.invoice_number}`,
        entityType: 'payment_submission',
        entityId: id,
        metadata: { reference: sub.reference, invoiceNumber: inv.invoice_number, verifiedAmount, currency: inv.currency, remaining },
      },
      now,
    );
    return { sub, verifiedAmount, remaining, currency: inv.currency };
  });
  const brand = await brandContext(deps);
  const invoice = await getInvoiceSummary(deps, result.sub.invoice_id);
  await notifySafely(deps, {
    templateKey: 'payment_approved',
    recipient: { type: 'client', clientId: result.sub.client_id, address: await clientEmail(deps.db, result.sub.client_id) },
    context: {
      ...invoiceContext(brand, invoice, result.verifiedAmount),
      reference: result.sub.reference,
      amount: formatMoney(result.verifiedAmount, result.currency),
    },
    dedupeKey: `verified:${id}`,
    invoiceId: result.sub.invoice_id,
    submissionId: id,
  });
  return { verifiedAmount: result.verifiedAmount, invoiceStatus: invoice.status, remaining: result.remaining };
}

async function notifyClientAbout(
  deps: Deps,
  sub: LockedSubmission,
  templateKey: 'info_requested' | 'payment_rejected',
  extra: { message?: string; reason?: string },
): Promise<void> {
  const brand = await brandContext(deps);
  const invoice = await getInvoiceSummary(deps, sub.invoice_id);
  await notifySafely(deps, {
    templateKey,
    recipient: { type: 'client', clientId: sub.client_id, address: await clientEmail(deps.db, sub.client_id) },
    context: {
      ...invoiceContext(brand, invoice, sub.amount_sent),
      reference: sub.reference,
      message: extra.message ?? '',
      reason: extra.reason ?? '',
    },
    dedupeKey: null,
    invoiceId: sub.invoice_id,
    submissionId: sub.id,
  });
}

/** Refunds are recorded manually after an administrator has sent money back outside the portal. */
export async function recordRefund(
  deps: Deps,
  invoiceId: string,
  input: { currency: Currency; amount: string; transferReference: string; note: string },
  actor: Actor,
): Promise<void> {
  const now = deps.now();
  requireUuid(invoiceId, 'invoice');
  const amount = parseAmountInput(input.amount);
  if (!amount) throw unprocessable('Enter the refund amount.', { amount: 'Invalid amount.' });
  const result = await deps.db.transaction(async (tx) => {
    const invRows = await tx.query<{ currency: Currency; invoice_number: string; client_id: string }>(
      'SELECT currency, invoice_number, client_id FROM invoices WHERE id = $1 FOR UPDATE',
      [invoiceId],
    );
    const invoice = invRows.rows[0];
    if (!invoice) throw notFound('That invoice does not exist.');
    if (invoice.currency !== input.currency) {
      throw unprocessable(`Refunds must be recorded in ${invoice.currency}.`, { currency: 'Use the invoice currency.' });
    }
    const net = await netPaid(tx, invoiceId);
    if (compareAmounts(net, '0.00') <= 0) throw conflict('There is no net verified payment to refund on this invoice.');
    if (compareAmounts(amount, net) > 0) {
      throw unprocessable(`The refund cannot be more than the net verified amount of ${formatMoney(net, invoice.currency)}.`, {
        amount: 'Too high.',
      });
    }
    const memo = input.note ? `${input.transferReference} — ${input.note}` : input.transferReference;
    await tx.query(
      `INSERT INTO payment_ledger (invoice_id, submission_id, kind, amount, currency, reference_note, recorded_by, recorded_at)
       VALUES ($1, NULL, 'refund', $2, $3, $4, $5, $6)`,
      [invoiceId, amount, invoice.currency, memo, actor.id, now],
    );
    await recordAudit(
      tx,
      actor,
      {
        action: 'payment.refund_recorded',
        summary: `Recorded manual refund of ${formatMoney(amount, invoice.currency)} on ${invoice.invoice_number}`,
        entityType: 'invoice',
        entityId: invoiceId,
        metadata: { amount, currency: invoice.currency, transferReference: input.transferReference, manual: true },
      },
      now,
    );
    return { clientId: invoice.client_id, currency: invoice.currency };
  });
  const brand = await brandContext(deps);
  const invoice = await getInvoiceSummary(deps, invoiceId);
  await notifySafely(deps, {
    templateKey: 'refund_recorded',
    recipient: { type: 'client', clientId: result.clientId, address: await clientEmail(deps.db, result.clientId) },
    context: {
      ...invoiceContext(brand, invoice, amount),
      transferReference: input.transferReference,
      amount: formatMoney(amount, result.currency),
    },
    dedupeKey: null,
    invoiceId,
  });
}
