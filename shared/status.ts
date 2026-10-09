// Status derivation. These pure functions are the single definition of what a status means.
// The server is the source of truth; the browser uses the same labels and tones.
// "Payment verified" is only ever derived from ledger entries created by an administrator's
// verification. A client's confirmation or an uploaded receipt never produces it.

import type { SubmissionStatus } from './constants';
import { compareAmounts, subtractAmounts } from './money';

export type Tone = 'neutral' | 'info' | 'warning' | 'success' | 'danger' | 'muted';

export const INVOICE_STATUS_META = {
  unpaid: { label: 'Unpaid', tone: 'neutral' },
  awaiting_payment: { label: 'Awaiting payment', tone: 'info' },
  confirmation_submitted: { label: 'Confirmation submitted', tone: 'info' },
  under_review: { label: 'Under review', tone: 'info' },
  info_requested: { label: 'Information requested', tone: 'warning' },
  payment_verified: { label: 'Payment verified', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  partially_paid: { label: 'Partially paid', tone: 'warning' },
  refunded: { label: 'Refunded', tone: 'muted' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
} as const;
export type InvoiceStatus = keyof typeof INVOICE_STATUS_META;

export const REFERENCE_STATUS_META = {
  awaiting_payment: { label: 'Awaiting payment', tone: 'info' },
  confirmation_submitted: { label: 'Confirmation submitted', tone: 'info' },
  under_review: { label: 'Under review', tone: 'info' },
  info_requested: { label: 'Information requested', tone: 'warning' },
  payment_verified: { label: 'Payment verified', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
} as const;
export type ReferenceStatus = keyof typeof REFERENCE_STATUS_META;

export const SUBMISSION_STATUS_META = {
  submitted: { label: 'Confirmation submitted', tone: 'info' },
  under_review: { label: 'Under review', tone: 'info' },
  info_requested: { label: 'Information requested', tone: 'warning' },
  verified: { label: 'Payment verified', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  superseded: { label: 'Replaced by a newer confirmation', tone: 'muted' },
} as const satisfies Record<SubmissionStatus, { label: string; tone: Tone }>;

export interface InvoiceStatusInput {
  cancelled: boolean;
  totalAmount: string;
  netPaid: string;
  hasRefund: boolean;
  pendingStatus: SubmissionStatus | null;
  latestClosedStatus: 'verified' | 'rejected' | null;
  hasIssuedReference: boolean;
  dueDate: string;
  today: string;
}

export interface DerivedInvoiceStatus {
  status: InvoiceStatus;
  label: string;
  tone: Tone;
  overdue: boolean;
  outstanding: string;
}

export function deriveInvoiceStatus(input: InvoiceStatusInput): DerivedInvoiceStatus {
  const zero = '0.00';
  const outstanding = subtractAmounts(input.totalAmount, input.netPaid);
  let status: InvoiceStatus;
  if (input.cancelled) {
    status = 'cancelled';
  } else if (input.hasRefund && compareAmounts(input.netPaid, zero) === 0) {
    status = 'refunded';
  } else if (compareAmounts(input.netPaid, input.totalAmount) >= 0) {
    status = 'payment_verified';
  } else if (compareAmounts(input.netPaid, zero) > 0) {
    status = 'partially_paid';
  } else if (input.pendingStatus === 'under_review') {
    status = 'under_review';
  } else if (input.pendingStatus === 'submitted') {
    status = 'confirmation_submitted';
  } else if (input.pendingStatus === 'info_requested') {
    status = 'info_requested';
  } else if (input.latestClosedStatus === 'rejected') {
    status = 'rejected';
  } else if (input.hasIssuedReference) {
    status = 'awaiting_payment';
  } else {
    status = 'unpaid';
  }
  const open = !['payment_verified', 'refunded', 'cancelled'].includes(status);
  const meta = INVOICE_STATUS_META[status];
  return {
    status,
    label: meta.label,
    tone: meta.tone,
    overdue: open && input.dueDate < input.today,
    outstanding,
  };
}

export function deriveReferenceStatus(
  cancelled: boolean,
  latestSubmissionStatus: SubmissionStatus | null,
): { status: ReferenceStatus; label: string; tone: Tone } {
  let status: ReferenceStatus;
  if (cancelled) status = 'cancelled';
  else if (latestSubmissionStatus === null) status = 'awaiting_payment';
  else if (latestSubmissionStatus === 'submitted') status = 'confirmation_submitted';
  else if (latestSubmissionStatus === 'under_review') status = 'under_review';
  else if (latestSubmissionStatus === 'info_requested') status = 'info_requested';
  else if (latestSubmissionStatus === 'verified') status = 'payment_verified';
  else if (latestSubmissionStatus === 'rejected') status = 'rejected';
  else status = 'awaiting_payment';
  const meta = REFERENCE_STATUS_META[status];
  return { status, label: meta.label, tone: meta.tone };
}
