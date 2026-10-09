// Request schemas shared by the API (validation) and the forms (immediate feedback).
// The server always re-validates; client-side validation is a convenience only.

import { z } from 'zod';
import {
  CURRENCIES,
  NOTIFICATION_TEMPLATE_KEYS,
  PAYMENT_METHODS,
  ROLES,
  SENDER_REQUIREMENT_OPTIONS,
} from './constants';
import { isValidIsoDate } from './dates';
import { isPositiveAmount, parseAmountInput } from './money';
import { EMAIL_PATTERN, UUID_PATTERN } from './settings';

const uuid = z.string().regex(UUID_PATTERN, 'Invalid identifier.');
const isoDate = z.string().refine(isValidIsoDate, 'Enter a valid date (YYYY-MM-DD).');
const amount = z
  .string()
  .trim()
  .refine((value) => parseAmountInput(value) !== null, 'Enter an amount with up to 2 decimal places.')
  .refine((value) => parseAmountInput(value) === null || isPositiveAmount(value), 'The amount must be greater than zero.');
const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine((value) => EMAIL_PATTERN.test(value), 'Enter a valid email address.');
const confirmed = z.boolean().refine((value) => value === true, 'Please confirm this action before continuing.');
const short = (max: number) => z.string().trim().max(max, `Use at most ${max} characters.`);

export const newPasswordSchema = z
  .string()
  .min(12, 'Use at least 12 characters.')
  .max(256, 'Use at most 256 characters.');

export const adminLoginSchema = z.object({
  email: z.string().trim().toLowerCase().max(254),
  password: z.string().min(1, 'Enter your password.').max(256),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.').max(256),
  newPassword: newPasswordSchema,
});

export const passwordResetRequestSchema = z.object({
  email: z.string().trim().toLowerCase().max(254),
});

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(20).max(200),
  newPassword: newPasswordSchema,
});

export const clientLoginSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name.').max(120),
  accessCode: z.string().min(1, 'Enter your access code.').max(256),
});

export const accessCodeSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(256, 'Use at most 256 characters.');

export const activationInspectSchema = z.object({
  token: z.string().min(20).max(200),
});

export const activationSchema = z.object({
  token: z.string().min(20).max(200),
  accessCode: accessCodeSchema,
});

export const changeAccessCodeSchema = z.object({
  currentAccessCode: z.string().min(1, 'Enter your current access code.').max(256),
  newAccessCode: accessCodeSchema,
});

export const clientProfileSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter the client full name.').max(120),
  email,
  phone: short(40),
});

export const clientStatusSchema = z.object({
  status: z.enum(['active', 'suspended']),
});

export const noteSchema = z.object({
  body: z.string().trim().min(1, 'Enter a note.').max(2000, 'Use at most 2000 characters.'),
});

export const invoiceLineItemSchema = z.object({
  description: z.string().trim().min(1, 'Describe the line item.').max(200),
  kind: z.enum(['charge', 'fee', 'discount']),
  amount,
});

const invoiceBase = z.object({
  description: z.string().trim().min(1, 'Enter a description.').max(300),
  currency: z.enum(CURRENCIES),
  issueDate: isoDate,
  dueDate: isoDate,
  partialPaymentsAllowed: z.boolean(),
  notes: short(2000),
  lineItems: z.array(invoiceLineItemSchema).min(1, 'Add at least one line item.').max(50),
});

export const invoiceCreateSchema = invoiceBase
  .extend({ clientId: uuid })
  .refine((value) => value.dueDate >= value.issueDate, {
    message: 'The due date cannot be before the issue date.',
    path: ['dueDate'],
  });

export const invoiceUpdateSchema = invoiceBase.partial();

export const referenceCreateSchema = z.object({
  currency: z.enum(CURRENCIES),
  method: z.enum(PAYMENT_METHODS),
  bankProfileId: uuid.nullable().optional(),
  senderCountry: z.string().trim().toUpperCase().regex(/^([A-Z]{2})?$/, 'Choose a country.').optional(),
  amount: z.string().trim().optional(),
});

export const submissionFieldsSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  currency: z.enum(CURRENCIES),
  sentOn: isoDate,
  amountSent: amount,
  senderName: short(120),
  senderCountry: z.string().trim().toUpperCase().regex(/^([A-Z]{2})?$/, 'Choose a country.'),
  transferReference: short(120),
  transactionId: short(120),
  note: short(1000),
});

export const verifySubmissionSchema = z.object({
  verifiedAmount: amount,
  confirm: confirmed,
  note: short(1000),
});

export const rejectSubmissionSchema = z.object({
  reason: z.string().trim().min(5, 'Give a reason the client can act on.').max(1000),
});

export const requestInfoSchema = z.object({
  message: z.string().trim().min(5, 'Say what information you need.').max(1000),
});

export const refundSchema = z.object({
  currency: z.enum(CURRENCIES),
  amount,
  transferReference: z.string().trim().min(3, 'Enter the transfer reference.').max(120),
  confirmManual: confirmed,
  note: short(1000),
});

export const cancelInvoiceSchema = z.object({
  reason: z.string().trim().min(5, 'Give a reason for cancelling.').max(1000),
  confirm: confirmed,
});

export const bankProfileSchema = z.object({
  currency: z.enum(CURRENCIES),
  transferType: z.string().min(1).max(40),
  label: z.string().trim().min(1, 'Enter a label for this bank profile.').max(120),
  enabled: z.boolean(),
  sortOrder: z.number().int().min(0).max(9999),
  fields: z.record(z.string(), z.string().max(4000)),
  confirmSensitiveChange: z.boolean().optional(),
});

export const bankProfilePatchSchema = bankProfileSchema.partial();

export const WU_MTCN_REQUIREMENTS = ['required', 'optional', 'not_used'] as const;
export const WU_RECEIPT_REQUIREMENTS = ['required', 'optional'] as const;

export const westernUnionConfigSchema = z.object({
  displayName: z.string().trim().min(1, 'Enter the display name.').max(80),
  supportedCurrencies: z.array(z.enum(CURRENCIES)).max(4),
  supportedCountries: z.array(z.string().regex(/^[A-Z]{2}$/, 'Use ISO country codes such as NG or GB.')).max(250),
  recipientName: short(200),
  recipientCity: short(120),
  recipientCountry: z.string().trim().toUpperCase().regex(/^([A-Z]{2})?$/, 'Use an ISO country code.'),
  instructions: short(4000),
  requiredSenderFields: z.array(z.enum(SENDER_REQUIREMENT_OPTIONS)).max(2),
  mtcnRequirement: z.enum(WU_MTCN_REQUIREMENTS),
  receiptRequirement: z.enum(WU_RECEIPT_REQUIREMENTS),
  additionalNotes: short(2000),
  clientHelpText: short(1000),
  supportText: short(1000),
});
export type WesternUnionConfig = z.infer<typeof westernUnionConfigSchema>;

export const WU_DEFAULT_CONFIG: WesternUnionConfig = {
  displayName: 'Western Union',
  supportedCurrencies: [],
  supportedCountries: [],
  recipientName: '',
  recipientCity: '',
  recipientCountry: '',
  instructions: '',
  requiredSenderFields: ['sender_name'],
  mtcnRequirement: 'required',
  receiptRequirement: 'required',
  additionalNotes: '',
  clientHelpText: '',
  supportText: '',
};

export const westernUnionSchema = z.object({
  enabled: z.boolean(),
  config: westernUnionConfigSchema,
});

export const enabledToggleSchema = z.object({ enabled: z.boolean() });

export const userCreateSchema = z.object({
  email,
  displayName: z.string().trim().min(2, 'Enter a name.').max(120),
  role: z.enum(ROLES),
});

export const userUpdateSchema = z.object({
  role: z.enum(ROLES).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

export const notificationPreviewSchema = z.object({
  templateKey: z.enum(NOTIFICATION_TEMPLATE_KEYS),
  subject: z.string().max(200),
  body: z.string().max(5000),
});

export const clientReminderSchema = z.object({
  invoiceId: uuid,
  template: z.enum(['payment_instructions_issued', 'invoice_due_soon', 'invoice_overdue']),
});

export const reviewTransitionSchema = z.object({
  note: short(1000).optional(),
});

export const reportQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  status: z.string().max(40).optional(),
});

export type AdminLoginInput = z.infer<typeof adminLoginSchema>;
export type InvoiceCreateInput = z.infer<typeof invoiceCreateSchema>;
export type InvoiceUpdateInput = z.infer<typeof invoiceUpdateSchema>;
export type ReferenceCreateInput = z.infer<typeof referenceCreateSchema>;
export type SubmissionFieldsInput = z.infer<typeof submissionFieldsSchema>;
export type BankProfileInput = z.infer<typeof bankProfileSchema>;
export type ClientProfileInput = z.infer<typeof clientProfileSchema>;
