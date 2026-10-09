export type InvoiceStatus =
  | 'draft'
  | 'unpaid'
  | 'awaiting_payment'
  | 'confirmation_submitted'
  | 'under_review'
  | 'paid'
  | 'partially_paid'
  | 'rejected'
  | 'refunded'
  | 'cancelled';

export type ConfirmationStatus = 'submitted' | 'under_review' | 'verified' | 'rejected' | 'info_requested';

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  unpaid: 'Unpaid',
  awaiting_payment: 'Awaiting payment',
  confirmation_submitted: 'Confirmation submitted',
  under_review: 'Under review',
  paid: 'Payment verified',
  partially_paid: 'Partially paid',
  rejected: 'Rejected',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
};

export const CONFIRMATION_STATUS_LABELS: Record<ConfirmationStatus, string> = {
  submitted: 'Awaiting verification',
  under_review: 'Under review',
  verified: 'Payment verified',
  rejected: 'Rejected',
  info_requested: 'More information needed',
};

type Tone = 'slate' | 'blue' | 'amber' | 'green' | 'red' | 'violet';

const TONE_CLASSES: Record<Tone, string> = {
  slate: 'bg-slate-100 text-slate-700 border-slate-200',
  blue: 'bg-blue-100 text-blue-800 border-blue-200',
  amber: 'bg-amber-100 text-amber-800 border-amber-200',
  green: 'bg-green-100 text-green-800 border-green-200',
  red: 'bg-red-100 text-red-800 border-red-200',
  violet: 'bg-violet-100 text-violet-800 border-violet-200',
};

export function invoiceStatusTone(status: InvoiceStatus): Tone {
  switch (status) {
    case 'paid':
      return 'green';
    case 'partially_paid':
      return 'blue';
    case 'unpaid':
      return 'amber';
    case 'awaiting_payment':
      return 'blue';
    case 'confirmation_submitted':
      return 'violet';
    case 'under_review':
      return 'blue';
    case 'rejected':
      return 'red';
    case 'refunded':
      return 'slate';
    case 'cancelled':
      return 'slate';
    case 'draft':
      return 'slate';
    default:
      return 'slate';
  }
}

export function confirmationStatusTone(status: ConfirmationStatus): Tone {
  switch (status) {
    case 'verified':
      return 'green';
    case 'submitted':
      return 'violet';
    case 'under_review':
      return 'blue';
    case 'rejected':
      return 'red';
    case 'info_requested':
      return 'amber';
    default:
      return 'slate';
  }
}

export function toneClasses(tone: Tone): string {
  return TONE_CLASSES[tone];
}
