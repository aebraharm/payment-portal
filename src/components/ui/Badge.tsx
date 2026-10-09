import type { ReactNode } from 'react';
import {
  confirmationStatusTone,
  invoiceStatusTone,
  toneClasses,
  INVOICE_STATUS_LABELS,
  CONFIRMATION_STATUS_LABELS,
  type ConfirmationStatus,
  type InvoiceStatus,
} from '../../lib/status';

export function Badge({ tone = 'slate', children, className = '' }: {
  tone?: 'slate' | 'blue' | 'amber' | 'green' | 'red' | 'violet';
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${toneClasses(tone)} ${className}`}
    >
      {children}
    </span>
  );
}

export function InvoiceStatusBadge({ status, className = '' }: { status: InvoiceStatus; className?: string }) {
  return (
    <Badge tone={invoiceStatusTone(status)} className={className}>
      {INVOICE_STATUS_LABELS[status] || status}
    </Badge>
  );
}

export function ConfirmationStatusBadge({ status, className = '' }: { status: ConfirmationStatus; className?: string }) {
  return (
    <Badge tone={confirmationStatusTone(status)} className={className}>
      {CONFIRMATION_STATUS_LABELS[status] || status}
    </Badge>
  );
}
