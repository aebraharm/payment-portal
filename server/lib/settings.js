import { run, get, all, isoNow, parseJson } from '../db.js';
import { config } from '../config.js';

/**
 * Default application settings. Everything here is editable from the Admin
 * Portal; nothing agency-specific is hardcoded in the frontend.
 */
export const DEFAULT_SETTINGS = {
  agency_name: '',
  site_title: 'Payment Portal',
  logo_path: '',
  favicon_path: '',
  contact_email: '',
  contact_phone: '',
  whatsapp_number: '',
  whatsapp_enabled: false,
  office_address: '',
  website_url: '',
  primary_color: config.brandDefaults.primaryColor,
  secondary_color: config.brandDefaults.secondaryColor,
  login_heading: 'Client sign in',
  login_description: 'Sign in with your full name and the access code issued by our team.',
  welcome_message: 'Welcome to your payment portal.',
  footer_text: '',
  terms_and_conditions: '',
  privacy_policy: '',
  refund_policy: '',
  payment_instructions: '',
  payment_disclaimer: '',
  support_email: '',
  support_phone: '',
  invoice_ref_prefix: 'INV',
  transaction_ref_prefix: 'PAY',
  invoice_due_days_default: 14,
  payment_deadline_reminder_days: 3,
  receipt_max_size_mb: 10,
  allowed_receipt_types: ['pdf', 'jpg', 'jpeg', 'png'],
  require_receipt_upload: true,
  require_sender_name: true,
  require_transfer_reference: true,
  client_workflow: {
    allow_partial_payments: true,
    allow_method_change_before_confirm: true,
    show_instructions_snapshot: true,
  },
  notification_templates: {
    client_created: {
      subject: 'Your payment portal access',
      body: 'Hello {{client_name}}, your payment portal account has been created. Client reference: {{client_code}}.',
    },
    invoice_created: {
      subject: 'New invoice {{invoice_ref}}',
      body: 'Hello {{client_name}}, a new invoice {{invoice_ref}} for {{amount}} {{currency}} has been issued. Due date: {{due_date}}.',
    },
    payment_confirmation_submitted: {
      subject: 'Payment confirmation received — {{payment_ref}}',
      body: 'A payment confirmation was submitted for {{payment_ref}} (invoice {{invoice_ref}}, {{amount}} {{currency}}). Please review it in the admin portal.',
    },
    payment_approved: {
      subject: 'Payment verified — {{payment_ref}}',
      body: 'Hello {{client_name}}, your payment of {{amount}} {{currency}} for invoice {{invoice_ref}} has been verified. Thank you.',
    },
    payment_rejected: {
      subject: 'Payment submission needs attention — {{payment_ref}}',
      body: 'Hello {{client_name}}, your payment submission for invoice {{invoice_ref}} could not be verified. Reason: {{reason}}. Please submit corrected information.',
    },
    info_requested: {
      subject: 'Additional information required — {{payment_ref}}',
      body: 'Hello {{client_name}}, we need additional information for your payment submission {{payment_ref}}: {{reason}}',
    },
    invoice_due_soon: {
      subject: 'Invoice {{invoice_ref}} is due soon',
      body: 'Hello {{client_name}}, invoice {{invoice_ref}} for {{amount}} {{currency}} is due on {{due_date}}.',
    },
    invoice_overdue: {
      subject: 'Invoice {{invoice_ref}} is overdue',
      body: 'Hello {{client_name}}, invoice {{invoice_ref}} for {{amount}} {{currency}} was due on {{due_date}} and remains unpaid.',
    },
  },
  notify_on_confirmation_submitted: true,
  notify_on_payment_approved: true,
  notify_on_payment_rejected: true,
  notify_on_invoice_created: true,
};

export async function getSetting(key) {
  const row = await get('SELECT value FROM settings WHERE key = ?', [key]);
  if (!row) return DEFAULT_SETTINGS[key];
  try {
    return JSON.parse(row.value);
  } catch {
    return DEFAULT_SETTINGS[key];
  }
}

export async function getAllSettings() {
  const rows = await all('SELECT key, value, updated_at FROM settings');
  const out = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    try {
      out[row.key] = JSON.parse(row.value);
    } catch {
      /* keep default */
    }
  }
  return out;
}

export async function setSetting(key, value, updatedBy = null) {
  const now = isoNow();
  await run(
    `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    [key, JSON.stringify(value), now, updatedBy]
  );
  return value;
}

export async function setSettings(entries, updatedBy = null) {
  for (const [key, value] of Object.entries(entries)) {
    await setSetting(key, value, updatedBy);
  }
}

export async function getPublicBranding() {
  const s = await getAllSettings();
  return {
    agencyName: s.agency_name || '',
    siteTitle: s.site_title || 'Payment Portal',
    logoPath: s.logo_path || '',
    faviconPath: s.favicon_path || '',
    contactEmail: s.contact_email || '',
    contactPhone: s.contact_phone || '',
    whatsappNumber: s.whatsapp_enabled ? s.whatsapp_number || '' : '',
    officeAddress: s.office_address || '',
    websiteUrl: s.website_url || '',
    primaryColor: s.primary_color || config.brandDefaults.primaryColor,
    secondaryColor: s.secondary_color || config.brandDefaults.secondaryColor,
    loginHeading: s.login_heading || '',
    loginDescription: s.login_description || '',
    welcomeMessage: s.welcome_message || '',
    footerText: s.footer_text || '',
    termsAndConditions: s.terms_and_conditions || '',
    privacyPolicy: s.privacy_policy || '',
    refundPolicy: s.refund_policy || '',
    paymentInstructions: s.payment_instructions || '',
    paymentDisclaimer: s.payment_disclaimer || '',
    supportEmail: s.support_email || s.contact_email || '',
    supportPhone: s.support_phone || s.contact_phone || '',
  };
}

export async function getEnabledCurrencies() {
  return (await all('SELECT * FROM currencies WHERE enabled = 1 ORDER BY sort_order, code')).map((r) => ({
    code: r.code,
    name: r.name,
    symbol: r.symbol,
  }));
}

export async function getCurrency(code) {
  return await get('SELECT * FROM currencies WHERE code = ?', [code]) || null;
}

export async function getPaymentMethod(code) {
  const row = await get('SELECT * FROM payment_methods WHERE code = ?', [code]);
  if (!row) return null;
  return { ...row, enabled: !!row.enabled, config: parseJson(row.config, {}) };
}

export async function getEnabledPaymentMethods() {
  return (await all('SELECT * FROM payment_methods WHERE enabled = 1 ORDER BY sort_order, code')).map((r) => ({
    ...r,
    enabled: !!r.enabled,
    config: parseJson(r.config, {}),
  }));
}
