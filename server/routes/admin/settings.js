import { Router } from 'express';
import multer from 'multer';
import { run, get, isoNow } from '../../db.js';
import { asyncHandler, badRequest, zodError, HttpError } from '../../lib/http.js';
import { audit } from '../../lib/audit.js';
import { requireAdmin, requireRole } from '../../middleware/auth.js';
import { getAllSettings, setSettings, getPublicBranding, DEFAULT_SETTINGS } from '../../lib/settings.js';
import { validateFileBuffer, storeFile, deleteStoredFile, LOGO_MIME_TYPES, FileValidationError } from '../../lib/storage.js';

const router = Router();
router.use(requireAdmin);
const requireConfigRole = requireRole('superadmin', 'admin');

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/\S+$/i;
const REF_PREFIX_RE = /^[A-Za-z][A-Za-z0-9-]{0,9}$/;

const STRING_KEYS = [
  'agency_name', 'site_title', 'contact_email', 'contact_phone', 'whatsapp_number',
  'office_address', 'website_url', 'login_heading', 'login_description', 'welcome_message',
  'footer_text', 'terms_and_conditions', 'privacy_policy', 'refund_policy',
  'payment_instructions', 'payment_disclaimer', 'support_email', 'support_phone',
];
const BOOL_KEYS = [
  'whatsapp_enabled', 'require_receipt_upload', 'require_sender_name', 'require_transfer_reference',
  'notify_on_confirmation_submitted', 'notify_on_payment_approved', 'notify_on_payment_rejected',
  'notify_on_invoice_created',
];

function validateSettingsPayload(payload) {
  const entries = {};
  const errors = [];
  const known = new Set([
    ...STRING_KEYS,
    ...BOOL_KEYS,
    'primary_color', 'secondary_color', 'invoice_due_days_default', 'payment_deadline_reminder_days',
    'receipt_max_size_mb', 'invoice_ref_prefix', 'transaction_ref_prefix', 'allowed_receipt_types',
    'client_workflow', 'notification_templates',
  ]);
  for (const [key, raw] of Object.entries(payload || {})) {
    if (!known.has(key)) {
      errors.push(`Unknown setting "${key}".`);
      continue;
    }
    if (STRING_KEYS.includes(key)) {
      if (typeof raw !== 'string') {
        errors.push(`Setting "${key}" must be a string.`);
        continue;
      }
      const value = raw.trim();
      if (['contact_email', 'support_email'].includes(key) && value && !EMAIL_RE.test(value)) {
        errors.push(`Setting "${key}" must be a valid email address.`);
        continue;
      }
      if (key === 'website_url' && value && !URL_RE.test(value)) {
        errors.push('Setting "website_url" must be a valid http(s) URL.');
        continue;
      }
      if (key === 'site_title' && !value) {
        errors.push('Setting "site_title" cannot be empty.');
        continue;
      }
      entries[key] = value;
    } else if (BOOL_KEYS.includes(key)) {
      if (typeof raw !== 'boolean') {
        errors.push(`Setting "${key}" must be true or false.`);
        continue;
      }
      entries[key] = raw;
    } else if (key === 'primary_color' || key === 'secondary_color') {
      if (typeof raw !== 'string' || !HEX_COLOR.test(raw.trim())) {
        errors.push(`Setting "${key}" must be a hex color like #2563eb.`);
        continue;
      }
      entries[key] = raw.trim();
    } else if (key === 'invoice_due_days_default') {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 365) {
        errors.push('Setting "invoice_due_days_default" must be a whole number between 1 and 365.');
        continue;
      }
      entries[key] = n;
    } else if (key === 'payment_deadline_reminder_days') {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > 60) {
        errors.push('Setting "payment_deadline_reminder_days" must be a whole number between 0 and 60.');
        continue;
      }
      entries[key] = n;
    } else if (key === 'receipt_max_size_mb') {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 50) {
        errors.push('Setting "receipt_max_size_mb" must be a whole number between 1 and 50.');
        continue;
      }
      entries[key] = n;
    } else if (key === 'invoice_ref_prefix' || key === 'transaction_ref_prefix') {
      if (typeof raw !== 'string' || !REF_PREFIX_RE.test(raw.trim())) {
        errors.push(`Setting "${key}" must start with a letter and contain only letters, digits and dashes (max 10 chars).`);
        continue;
      }
      entries[key] = raw.trim().toUpperCase();
    } else if (key === 'allowed_receipt_types') {
      if (!Array.isArray(raw) || raw.length === 0 || raw.some((t) => !['pdf', 'jpg', 'jpeg', 'png'].includes(t))) {
        errors.push('Setting "allowed_receipt_types" must be a non-empty subset of: pdf, jpg, jpeg, png.');
        continue;
      }
      entries[key] = raw;
    } else if (key === 'client_workflow') {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        errors.push('Setting "client_workflow" must be an object.');
        continue;
      }
      const wf = {
        allow_partial_payments: raw.allow_partial_payments !== false,
        allow_method_change_before_confirm: raw.allow_method_change_before_confirm !== false,
        show_instructions_snapshot: raw.show_instructions_snapshot !== false,
      };
      entries[key] = wf;
    } else if (key === 'notification_templates') {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        errors.push('Setting "notification_templates" must be an object.');
        continue;
      }
      const base = DEFAULT_SETTINGS.notification_templates;
      const merged = {};
      for (const [tplKey, tpl] of Object.entries(raw)) {
        if (typeof tpl !== 'object' || tpl === null) {
          errors.push(`Notification template "${tplKey}" must be an object with subject and body.`);
          continue;
        }
        merged[tplKey] = {
          subject: String(tpl.subject ?? base[tplKey]?.subject ?? ''),
          body: String(tpl.body ?? base[tplKey]?.body ?? ''),
        };
      }
      entries[key] = { ...base, ...merged };
    }
  }
  if (errors.length) {
    throw new HttpError(400, 'Some settings are invalid.', 'validation_error', errors.map((m) => ({ message: m })));
  }
  return entries;
}

router.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    res.json({ settings: await getAllSettings() });
  })
);

router.put(
  '/settings',
  requireConfigRole,
  asyncHandler(async (req, res) => {
    let entries;
    try {
      entries = validateSettingsPayload(req.body?.settings ?? req.body);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw zodError(e);
    }
    await setSettings(entries, req.admin.id);
    await audit(req, {
      action: 'settings_updated',
      entity: 'settings',
      details: { keys: Object.keys(entries) },
    });
    res.json({ ok: true, settings: await getAllSettings() });
  })
);

/**
 * Branding preview: validate a settings payload and return the branding as it
 * would appear, WITHOUT persisting anything. "Publishing" is a normal save.
 */
router.post(
  '/settings/preview',
  requireConfigRole,
  asyncHandler(async (req, res) => {
    let entries;
    try {
      entries = validateSettingsPayload(req.body?.settings ?? req.body);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw zodError(e);
    }
    const current = await getAllSettings();
    const merged = { ...current, ...entries };
    const preview = {
      agencyName: merged.agency_name || '',
      siteTitle: merged.site_title,
      logoPath: merged.logo_path || '',
      primaryColor: merged.primary_color,
      secondaryColor: merged.secondary_color,
      loginHeading: merged.login_heading,
      loginDescription: merged.login_description,
      welcomeMessage: merged.welcome_message,
      footerText: merged.footer_text,
      contactEmail: merged.contact_email,
      supportEmail: merged.support_email || merged.contact_email,
    };
    res.json({ preview, persisted: false });
  })
);

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

router.post(
  '/settings/logo',
  requireConfigRole,
  (req, res, next) => logoUpload.single('logo')(req, res, next),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('Upload a logo image file (field name "logo").');
    try {
      const { ext, mime } = validateFileBuffer({
        buffer: req.file.buffer,
        originalName: req.file.originalname,
        allowed: LOGO_MIME_TYPES,
        maxBytes: 2 * 1024 * 1024,
        label: 'Logo',
      });
      const previous = await get('SELECT value FROM settings WHERE key = ?', ['logo_path']);
      const stored = await storeFile({ buffer: req.file.buffer, subdir: 'branding', ext, contentType: mime });
      await run(
        `INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('logo_path', ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        [JSON.stringify(stored.relativePath), isoNow(), req.admin.id]
      );
      if (previous) {
        try {
          await deleteStoredFile(JSON.parse(previous.value));
        } catch {
          /* ignore */
        }
      }
      await audit(req, { action: 'branding_logo_uploaded', entity: 'settings', details: { mime, file: req.file.originalname } });
      res.json({ ok: true, logoPath: stored.relativePath, logoUrl: '/api/public/branding/logo' });
    } catch (e) {
      if (e instanceof FileValidationError) throw badRequest(e.message);
      throw e;
    }
  })
);

router.delete(
  '/settings/logo',
  requireConfigRole,
  asyncHandler(async (req, res) => {
    const previous = await get('SELECT value FROM settings WHERE key = ?', ['logo_path']);
    await run(
      `INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('logo_path', '""', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      [isoNow(), req.admin.id]
    );
    if (previous) {
      try {
        await deleteStoredFile(JSON.parse(previous.value));
      } catch {
        /* ignore */
      }
    }
    await audit(req, { action: 'branding_logo_removed', entity: 'settings' });
    res.json({ ok: true });
  })
);

// Exposed for tests / debugging: the raw public branding document.
router.get(
  '/settings/public-branding',
  asyncHandler(async (_req, res) => {
    res.json({ branding: await getPublicBranding() });
  })
);

export default router;
