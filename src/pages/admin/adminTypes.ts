import type { Tone } from '../../lib/format';

export type DeliveryOutcome = 'sent' | 'failed' | 'not_configured' | 'skipped' | 'duplicate' | 'disabled';

export interface ClientInvitation {
  activationUrl: string;
  notification: DeliveryOutcome;
  expiresAt?: string;
}

export interface ClientListRow {
  id: string;
  clientCode: string;
  fullName: string;
  email: string;
  phone: string;
  status: 'active' | 'suspended';
  hasAccessCode: boolean;
  invitationPending: boolean;
  openInvoices: number;
  createdAt: string;
}

export interface AdminInvoiceRow {
  id: string;
  invoiceNumber: string;
  clientId: string;
  clientName: string;
  clientCode: string;
  description: string;
  currency: string;
  totalAmount: string;
  netPaid: string;
  outstanding: string;
  issueDate: string;
  dueDate: string;
  partialPaymentsAllowed: boolean;
  notes: string;
  status: string;
  statusLabel: string;
  tone: Tone;
  overdue: boolean;
}

export interface ClientDetail {
  client: {
    id: string;
    clientCode: string;
    fullName: string;
    email: string;
    phone: string;
    status: 'active' | 'suspended';
    hasAccessCode: boolean;
    invitationPending: boolean;
  };
  invoices: AdminInvoiceRow[];
  notes: { id: string; body: string; authorName: string; createdAt: string }[];
}

export interface LineItemDraft {
  description: string;
  kind: 'charge' | 'fee' | 'discount';
  amount: string;
}
