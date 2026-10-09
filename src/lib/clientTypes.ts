import type { Tone } from './format';

export interface ClientInvoice {
  id: string;
  invoiceNumber: string;
  description: string;
  currency: string;
  total: string;
  totalFormatted: string;
  paid: string;
  outstanding: string;
  outstandingFormatted: string;
  issueDate: string;
  dueDate: string;
  partialPaymentsAllowed: boolean;
  status: string;
  statusLabel: string;
  tone: Tone;
  overdue: boolean;
  notes: string;
}

export interface SnapshotField {
  key: string;
  label: string;
  value: string;
  sensitive: boolean;
}

export type Requirement = 'required' | 'optional' | 'hidden';

export interface InstructionSnapshot {
  method: 'bank_transfer' | 'western_union';
  methodLabel: string;
  currency: string;
  amount: string;
  reference: string;
  invoiceNumber: string;
  issuedAt: string;
  bank: null | { profileLabel: string; transferType: string; transferTypeLabel: string; fields: SnapshotField[]; additionalInstructions: string };
  westernUnion: null | { displayName: string; recipientName: string; recipientCity: string; recipientCountry: string; instructions: string; additionalNotes: string };
  requirements: { senderName: Requirement; senderCountry: Requirement; transferReference: Requirement; transactionId: Requirement; receipt: Requirement };
  transactionIdLabel: string;
  guidance: { referenceInstruction: string; paymentDisclaimer: string };
}

export interface ReceiptItem {
  id: string;
  originalName: string;
  contentType: string;
  byteSize: number;
  uploadedAt: string;
}

export interface ClientSubmission {
  id: string;
  attemptNo: number;
  status: string;
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
  receipts: ReceiptItem[];
  timeline: { status: string; label: string; at: string }[];
}

export interface ClientReference {
  id: string;
  reference: string;
  invoiceId: string;
  invoiceNumber: string;
  method: 'bank_transfer' | 'western_union';
  methodLabel: string;
  currency: string;
  amount: string;
  amountFormatted: string;
  status: string;
  statusLabel: string;
  tone: Tone;
  issuedAt: string;
  instructions: InstructionSnapshot;
  submissions: ClientSubmission[];
  canSubmitConfirmation: boolean;
  confirmationBlockedReason: string | null;
}

export interface PaymentMethodOption {
  method: 'bank_transfer' | 'western_union' | 'card';
  label: string;
  available: boolean;
  reason: string | null;
  bankAccounts: { id: string; label: string; transferTypeLabel: string }[];
}

export interface PaymentOptions {
  outstanding: string;
  partialPaymentsAllowed: boolean;
  currency: { code: string; name: string; payable: boolean; note: string };
  methods: PaymentMethodOption[];
}

export interface InvoiceDetailView {
  invoice: ClientInvoice;
  lineItems: { description: string; kind: string; amount: string; amountFormatted: string }[];
  options: PaymentOptions;
  references: ClientReference[];
}

export interface ClientDashboardView {
  client: { name: string; code: string };
  welcome: string;
  summary: {
    openInvoices: number;
    overdueInvoices: number;
    outstandingByCurrency: { currency: string; amount: string; amountFormatted: string }[];
    pendingConfirmations: number;
  };
  invoices: ClientInvoice[];
  recentReferences: ClientReference[];
  pendingConfirmations: { reference: string; status: string; statusLabel: string; submittedAt: string }[];
  notifications: { id: string; subject: string; sentAt: string }[];
  today: string;
}
