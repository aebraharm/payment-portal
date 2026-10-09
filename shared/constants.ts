// Shared constants used by the server, the browser bundle and the tests.
// Nothing in this file is agency-specific: agency identity, bank details and
// amounts are stored in the database and edited from the Admin Portal.

export const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const CURRENCY_NAMES: Record<Currency, string> = {
  USD: 'United States Dollar',
  CAD: 'Canadian Dollar',
  EUR: 'Euro',
  GBP: 'British Pound Sterling',
};

export const PAYMENT_METHODS = ['bank_transfer', 'western_union', 'card'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Methods that are confirmed manually through a client confirmation and admin review. */
export const MANUAL_METHODS = ['bank_transfer', 'western_union'] as const;
export type ManualMethod = (typeof MANUAL_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  bank_transfer: 'Bank transfer',
  western_union: 'Western Union',
  card: 'Card payment',
};

/** Exact label required for the disabled card option. Deliberately not configurable. */
export const CARD_UNAVAILABLE_LABEL = 'Not available in your region';

/** Exact label required for the payment confirmation button. */
export const CONFIRM_SENT_LABEL = 'I HAVE SENT THE MONEY';

/** Password and access-code policy. Enforced on the server; the forms only mirror these numbers. */
export const ADMIN_PASSWORD_MIN_LENGTH = 12;
export const BOOTSTRAP_PASSWORD_MIN_LENGTH = 10;
export const ACCESS_CODE_MIN_LENGTH = 10;

export const RECEIPT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export type ReceiptMimeType = (typeof RECEIPT_MIME_TYPES)[number];
export const RECEIPT_TYPE_LABELS: Record<ReceiptMimeType, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
};
/** Netlify synchronous functions accept request bodies up to 6 MB; keep headroom for multipart overhead. */
export const RECEIPT_HARD_MAX_BYTES = 5 * 1024 * 1024;
export const LOGO_MAX_BYTES = 1024 * 1024;
export const FAVICON_MAX_BYTES = 256 * 1024;

/** "superseded" closes an information request when the client sends a replacement confirmation. */
export const SUBMISSION_STATUSES = [
  'submitted',
  'under_review',
  'info_requested',
  'verified',
  'rejected',
  'superseded',
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];
export const PENDING_SUBMISSION_STATUSES = ['submitted', 'under_review', 'info_requested'] as const;

export const ROLES = ['super_admin', 'finance_reviewer', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super administrator',
  finance_reviewer: 'Finance reviewer',
  viewer: 'Read-only viewer',
};

export const PERMISSIONS = [
  'dashboard:read',
  'clients:read',
  'clients:write',
  'invoices:read',
  'invoices:write',
  'payments:read',
  'payments:review',
  'refunds:record',
  'receipts:read',
  'notes:write',
  'notifications:read',
  'notifications:write',
  'reports:export',
  'audit:read',
  'settings:read',
  'settings:write',
  'payment_config:write',
  'users:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const VIEWER_PERMISSIONS: Permission[] = [
  'dashboard:read',
  'clients:read',
  'invoices:read',
  'payments:read',
  'receipts:read',
  'notifications:read',
  'audit:read',
];

const FINANCE_PERMISSIONS: Permission[] = [
  ...VIEWER_PERMISSIONS,
  'clients:write',
  'invoices:write',
  'payments:review',
  'refunds:record',
  'notes:write',
  'notifications:write',
  'reports:export',
  'settings:read',
];

/** Server-side authorization map. The UI mirrors it for navigation only; the API enforces it. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  viewer: VIEWER_PERMISSIONS,
  finance_reviewer: FINANCE_PERMISSIONS,
  super_admin: [...PERMISSIONS],
};

export const NOTIFICATION_TEMPLATE_KEYS = [
  'client_created',
  'client_invitation',
  'invoice_created',
  'payment_instructions_issued',
  'confirmation_submitted',
  'receipt_uploaded',
  'payment_approved',
  'payment_rejected',
  'info_requested',
  'invoice_due_soon',
  'invoice_overdue',
  'refund_recorded',
  'admin_password_reset',
  'admin_invitation',
] as const;
export type NotificationTemplateKey = (typeof NOTIFICATION_TEMPLATE_KEYS)[number];

/** Templates whose bodies contain one-time links. Their bodies are never stored in the database. */
export const SENSITIVE_TEMPLATE_KEYS: readonly NotificationTemplateKey[] = [
  'client_invitation',
  'admin_password_reset',
  'admin_invitation',
];

export const TEMPLATE_PLACEHOLDERS = [
  'agencyName',
  'clientName',
  'clientCode',
  'invoiceNumber',
  'invoiceDescription',
  'amount',
  'currency',
  'dueDate',
  'reference',
  'status',
  'reason',
  'message',
  'transferReference',
  'receiptStatus',
  'portalUrl',
  'supportEmail',
  'activationUrl',
  'resetUrl',
] as const;
export type TemplatePlaceholder = (typeof TEMPLATE_PLACEHOLDERS)[number];

export const SENDER_REQUIREMENT_OPTIONS = ['sender_name', 'sender_country'] as const;
export type SenderRequirement = (typeof SENDER_REQUIREMENT_OPTIONS)[number];
