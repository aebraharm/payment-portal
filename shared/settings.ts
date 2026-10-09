// Editable agency settings. Each group is stored with a draft and a published copy.
// Administrators edit drafts, preview them, then publish. Public pages read published values only.

import { z } from 'zod';
import { NOTIFICATION_TEMPLATE_KEYS, TEMPLATE_PLACEHOLDERS, type NotificationTemplateKey } from './constants';

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const text = (max: number) => z.string().trim().max(max, `Use at most ${max} characters.`);
const hexColor = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit colour such as #1d4ed8.');
const optionalUuid = z.string().regex(UUID_PATTERN, 'Invalid asset reference.').nullable();

export const brandingSettingsSchema = z.object({
  agencyName: text(120),
  websiteTitle: text(120),
  primaryColor: hexColor,
  secondaryColor: hexColor,
  loginHeading: text(120),
  loginDescription: text(500),
  clientWelcomeMessage: text(500),
  footerText: text(300),
  logoAssetId: optionalUuid,
  faviconAssetId: optionalUuid,
});
export type BrandingSettings = z.infer<typeof brandingSettingsSchema>;

export const contactSettingsSchema = z
  .object({
    supportEmail: z
      .string()
      .trim()
      .max(254)
      .refine((value) => value === '' || EMAIL_PATTERN.test(value), 'Enter a valid email address, or leave blank.'),
    phone: text(40),
    whatsappEnabled: z.boolean(),
    whatsappNumber: text(40),
    address: text(500),
    websiteUrl: z
      .string()
      .trim()
      .max(300)
      .refine((value) => value === '' || /^https?:\/\/\S+$/.test(value), 'Use a full address starting with https://'),
    supportHours: text(200),
  })
  .refine((value) => !value.whatsappEnabled || value.whatsappNumber.length > 0, {
    message: 'Enter a WhatsApp number, or turn WhatsApp off.',
    path: ['whatsappNumber'],
  });
export type ContactSettings = z.infer<typeof contactSettingsSchema>;

export const policiesSettingsSchema = z.object({
  termsText: text(20000),
  privacyText: text(20000),
  refundText: text(20000),
  paymentDisclaimer: text(4000),
  feesNotice: text(2000),
  nextStepsText: text(2000),
});
export type PoliciesSettings = z.infer<typeof policiesSettingsSchema>;

export const workflowSettingsSchema = z.object({
  requireReceipt: z.boolean(),
  requireSenderName: z.boolean(),
  requireTransferReference: z.boolean(),
  requireTransactionId: z.boolean(),
  maxReceiptMegabytes: z.number().int().min(1).max(5),
  notifyAdminOnSubmission: z.boolean(),
  confirmationInstructions: text(1000),
  defaultPartialPaymentsAllowed: z.boolean(),
});
export type WorkflowSettings = z.infer<typeof workflowSettingsSchema>;

const TOKEN_PATTERN = /\{(YYYY|YY|MM|SEQ(?::(?:[1-9]|1[0-2]))?)\}/g;

/** A format must contain a sequence token and may only use the documented tokens plus safe literal characters. */
export function isValidInvoiceNumberFormat(format: string): boolean {
  if (!/\{SEQ(?::(?:[1-9]|1[0-2]))?\}/.test(format)) return false;
  const literal = format.replace(TOKEN_PATTERN, '');
  return /^[A-Za-z0-9\-_/ ]*$/.test(literal);
}

export const operationsSettingsSchema = z.object({
  referencePrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,8}$/, 'Use 2 to 8 letters or digits.'),
  invoiceNumberFormat: z
    .string()
    .trim()
    .min(3, 'Enter an invoice number format.')
    .max(64, 'Use at most 64 characters.')
    .refine(
      isValidInvoiceNumberFormat,
      'Include {SEQ} or {SEQ:5}. You may also use {YYYY}, {YY} and {MM}, with letters, digits, dashes, underscores or slashes.',
    ),
  defaultDueDays: z.number().int().min(1).max(365),
  reminderDaysBefore: z.array(z.number().int().min(0).max(90)).max(5),
  overdueReminderEveryDays: z.number().int().min(0).max(90),
});
export type OperationsSettings = z.infer<typeof operationsSettingsSchema>;

export const labelsSettingsSchema = z.object({
  helpSenderName: text(300),
  helpTransferReference: text(300),
  helpTransactionId: text(300),
  helpReceipt: text(300),
  clientNotice: text(500),
  supportHelpText: text(500),
});
export type LabelsSettings = z.infer<typeof labelsSettingsSchema>;

export function unknownPlaceholders(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) {
    if (!(TEMPLATE_PLACEHOLDERS as readonly string[]).includes(match[1])) found.add(match[1]);
  }
  return [...found];
}

export const notificationTemplateSchema = z.object({
  enabled: z.boolean(),
  subject: z
    .string()
    .trim()
    .min(1, 'Enter a subject.')
    .max(200, 'Use at most 200 characters.')
    .refine((value) => !/[\r\n]/.test(value), 'The subject must be a single line.')
    .refine((value) => unknownPlaceholders(value).length === 0, 'The subject uses an unknown placeholder.'),
  body: z
    .string()
    .trim()
    .min(1, 'Enter the message text.')
    .max(5000, 'Use at most 5000 characters.')
    .refine((value) => unknownPlaceholders(value).length === 0, 'The message uses an unknown placeholder.'),
});
export type NotificationTemplate = z.infer<typeof notificationTemplateSchema>;

const templateShape = Object.fromEntries(
  NOTIFICATION_TEMPLATE_KEYS.map((key) => [key, notificationTemplateSchema]),
) as Record<NotificationTemplateKey, typeof notificationTemplateSchema>;
export const notificationsSettingsSchema = z.object(templateShape);
export type NotificationsSettings = z.infer<typeof notificationsSettingsSchema>;

export const SETTINGS_SCHEMAS = {
  branding: brandingSettingsSchema,
  contact: contactSettingsSchema,
  policies: policiesSettingsSchema,
  workflow: workflowSettingsSchema,
  operations: operationsSettingsSchema,
  labels: labelsSettingsSchema,
  notifications: notificationsSettingsSchema,
};

export type SettingsKey = keyof typeof SETTINGS_SCHEMAS;
export const SETTINGS_KEYS = Object.keys(SETTINGS_SCHEMAS) as SettingsKey[];

export interface SettingsValues {
  branding: BrandingSettings;
  contact: ContactSettings;
  policies: PoliciesSettings;
  workflow: WorkflowSettings;
  operations: OperationsSettings;
  labels: LabelsSettings;
  notifications: NotificationsSettings;
}

const templateDefaults = (
  subject: string,
  body: string,
): NotificationTemplate => ({ enabled: true, subject, body });

export const DEFAULT_SETTINGS: SettingsValues = {
  branding: {
    agencyName: '',
    websiteTitle: '',
    primaryColor: '#1d4ed8',
    secondaryColor: '#0b1f44',
    loginHeading: 'Client payment portal',
    loginDescription: 'Sign in with your full name and access code to view invoices, payment instructions and confirmations.',
    clientWelcomeMessage: 'Review your invoices, follow the payment instructions and track every confirmation in one place.',
    footerText: '',
    logoAssetId: null,
    faviconAssetId: null,
  },
  contact: {
    supportEmail: '',
    phone: '',
    whatsappEnabled: false,
    whatsappNumber: '',
    address: '',
    websiteUrl: '',
    supportHours: '',
  },
  policies: {
    termsText: '',
    privacyText: '',
    refundText: '',
    paymentDisclaimer: '',
    feesNotice: '',
    nextStepsText: 'After you send the payment, use the confirmation button to submit your confirmation. Your invoice is updated only after the payment has been verified.',
  },
  workflow: {
    requireReceipt: true,
    requireSenderName: true,
    requireTransferReference: true,
    requireTransactionId: false,
    maxReceiptMegabytes: 5,
    notifyAdminOnSubmission: true,
    confirmationInstructions: 'Upload a clear copy of your receipt or proof of transfer. Make sure the amount, date and reference are visible.',
    defaultPartialPaymentsAllowed: false,
  },
  operations: {
    referencePrefix: 'PAY',
    invoiceNumberFormat: 'INV-{YYYY}-{SEQ:5}',
    defaultDueDays: 14,
    reminderDaysBefore: [7, 1],
    overdueReminderEveryDays: 7,
  },
  labels: {
    helpSenderName: 'The name on the account or money-transfer record that sent the payment.',
    helpTransferReference: 'Enter the reference that appears on your bank or transfer record.',
    helpTransactionId: 'Enter the transaction ID from your bank or provider, if you have one.',
    helpReceipt: 'PDF, JPEG or PNG. Maximum size shown below.',
    clientNotice: '',
    supportHelpText: 'Need help with a payment? Contact the agency using the details below.',
  },
  notifications: {
    client_created: templateDefaults(
      'Your {{agencyName}} client profile is ready',
      'Hello {{clientName}},\n\nA client profile has been created for you. You will receive a separate secure link to set up portal access.',
    ),
    client_invitation: templateDefaults(
      'Set up your {{agencyName}} portal access',
      'Hello {{clientName}},\n\nUse this secure link to set your access code for the payment portal:\n{{activationUrl}}\n\nThe link expires in 7 days. If you were not expecting this message, contact {{supportEmail}}.',
    ),
    invoice_created: templateDefaults(
      'Invoice {{invoiceNumber}} is ready',
      'Hello {{clientName}},\n\nInvoice {{invoiceNumber}} for {{amount}} is due on {{dueDate}}.\nDescription: {{invoiceDescription}}\n\nSign in to the portal to see payment options: {{portalUrl}}',
    ),
    payment_instructions_issued: templateDefaults(
      'Payment instructions for {{invoiceNumber}}',
      'Hello {{clientName}},\n\nPayment instructions for invoice {{invoiceNumber}} are available in the portal.\nAmount: {{amount}}\nReference: {{reference}}\n\n{{portalUrl}}',
    ),
    confirmation_submitted: templateDefaults(
      'We received your payment confirmation',
      'Hello {{clientName}},\n\nWe received your payment confirmation for reference {{reference}}. It is now awaiting verification. This is not yet confirmation that the payment has been received.',
    ),
    receipt_uploaded: templateDefaults(
      'Payment confirmation received: {{reference}}',
      'A payment confirmation was submitted.\nClient: {{clientName}} ({{clientCode}})\nInvoice: {{invoiceNumber}}\nReference: {{reference}}\nAmount: {{amount}}\nReceipt: {{receiptStatus}}',
    ),
    payment_approved: templateDefaults(
      'Payment verified for {{invoiceNumber}}',
      'Hello {{clientName}},\n\nWe have verified your payment for invoice {{invoiceNumber}}.\nReference: {{reference}}\n\n{{portalUrl}}',
    ),
    payment_rejected: templateDefaults(
      'Action needed: payment confirmation for {{reference}}',
      'Hello {{clientName}},\n\nWe could not accept the payment confirmation for reference {{reference}}.\nReason: {{reason}}\n\nYou can submit corrected information in the portal: {{portalUrl}}',
    ),
    info_requested: templateDefaults(
      'More information needed for {{reference}}',
      'Hello {{clientName}},\n\nWe need more information about your payment for reference {{reference}}.\n{{message}}\n\n{{portalUrl}}',
    ),
    invoice_due_soon: templateDefaults(
      'Reminder: invoice {{invoiceNumber}} is due {{dueDate}}',
      'Hello {{clientName}},\n\nThis is a reminder that invoice {{invoiceNumber}} for {{amount}} is due on {{dueDate}}.\n\n{{portalUrl}}',
    ),
    invoice_overdue: templateDefaults(
      'Overdue: invoice {{invoiceNumber}}',
      'Hello {{clientName}},\n\nInvoice {{invoiceNumber}} for {{amount}} was due on {{dueDate}} and is overdue.\n\n{{portalUrl}}',
    ),
    refund_recorded: templateDefaults(
      'Refund recorded for {{invoiceNumber}}',
      'Hello {{clientName}},\n\nA refund of {{amount}} has been recorded against invoice {{invoiceNumber}}.\nTransfer reference: {{transferReference}}',
    ),
    admin_password_reset: templateDefaults(
      'Reset your admin password',
      'Use this link to choose a new password. It expires in 30 minutes and can only be used once:\n{{resetUrl}}\n\nIf you did not request this, ignore this message.',
    ),
    admin_invitation: templateDefaults(
      'Set up your admin account',
      'You have been given access to the payment portal administration area. Set your password with this link. It expires in 7 days:\n{{resetUrl}}',
    ),
  },
};
