import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { makeApp, loginAdmin, get } from './helpers';
import { run, isoNow } from '../../server/db.js';

/**
 * Regression tests for the admin settings save flow.
 *
 * The Admin "Branding & settings" page loads the COMPLETE settings document
 * from GET /api/admin/settings and PUTs that same document back when the admin
 * saves. GET includes server-managed storage paths (logo_path, favicon_path),
 * which the validator used to reject as "Unknown setting", so every save from
 * the UI failed with a generic "Some settings are invalid." — even when the
 * admin only changed the portal name.
 *
 * These tests pin the contract: a faithful round-trip must succeed, storage
 * paths stay owned by the upload endpoints, and every other validation rule is
 * still enforced with field-specific error details.
 */

/** A minimal buffer with a valid PNG signature. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02]);

describe('admin settings save (API contract round-trip)', () => {
  let app: any;
  let admin: request.SuperAgentTest;

  beforeAll(async () => {
    app = await makeApp();
    ({ agent: admin } = await loginAdmin(app));
  });

  /** Exactly what the branding form does on load. */
  const loadSettings = async (): Promise<Record<string, any>> => {
    const res = await admin.get('/api/admin/settings');
    expect(res.status).toBe(200);
    return res.body.settings;
  };

  /** Exactly what the branding form does on save: the whole document back. */
  const saveSettings = (settings: Record<string, any>) =>
    admin.put('/api/admin/settings').send({ settings });

  const pathsOf = (res: any): string[] => (res.body?.error?.details ?? []).map((d: any) => d.path);
  const messagesOf = (res: any): string[] => (res.body?.error?.details ?? []).map((d: any) => d.message);

  it('GET returns the complete document, including server-managed storage paths', async () => {
    const settings = await loadSettings();
    expect(settings).toHaveProperty('logo_path');
    expect(settings).toHaveProperty('favicon_path');
    expect(settings).toHaveProperty('site_title');
    expect(settings).toHaveProperty('notification_templates');
  });

  // ---------------------------------------------------------------------
  // 1. Updating the portal name while the API returns logo/favicon fields
  // ---------------------------------------------------------------------
  it('saves a portal-name edit when the payload still carries logo_path and favicon_path', async () => {
    const settings = await loadSettings();
    expect(settings).toHaveProperty('logo_path');
    expect(settings).toHaveProperty('favicon_path');

    const put = await saveSettings({
      ...settings,
      agency_name: 'Roundtrip Migration Agency',
      site_title: 'Roundtrip Payment Portal',
    });

    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body.settings.agency_name).toBe('Roundtrip Migration Agency');
    expect(put.body.settings.site_title).toBe('Roundtrip Payment Portal');

    const after = await loadSettings();
    expect(after.agency_name).toBe('Roundtrip Migration Agency');
    expect(after.site_title).toBe('Roundtrip Payment Portal');
  });

  it('saves an unmodified round-trip of the document it just returned', async () => {
    const settings = await loadSettings();
    const put = await saveSettings(settings);
    expect(put.status, JSON.stringify(put.body)).toBe(200);
  });

  // ---------------------------------------------------------------------
  // 2. Uploading a logo and subsequently saving settings
  // ---------------------------------------------------------------------
  it('saves settings after a logo upload, and the uploaded logo survives', async () => {
    const upload = await admin.post('/api/admin/settings/logo').attach('logo', PNG, 'logo.png');
    expect(upload.status).toBe(200);
    expect(upload.body.logoPath).toBeTruthy();

    const settings = await loadSettings();
    expect(settings.logo_path).toBeTruthy();

    const put = await saveSettings({ ...settings, welcome_message: 'Logo uploaded, then settings saved.' });
    expect(put.status, JSON.stringify(put.body)).toBe(200);

    const after = await loadSettings();
    expect(after.logo_path).toBe(settings.logo_path);
    expect(after.welcome_message).toBe('Logo uploaded, then settings saved.');

    // The stored logo is still served — the settings save did not clobber it.
    expect((await request(app).get('/api/public/branding/logo')).status).toBe(200);
  });

  // ---------------------------------------------------------------------
  // 3. Explicit ownership of storage paths
  // ---------------------------------------------------------------------
  it('does not rewrite server-managed storage paths when other settings are saved', async () => {
    const before = await get("SELECT value, updated_at FROM settings WHERE key = 'logo_path'");
    expect(before).toBeTruthy();

    const settings = await loadSettings();
    const put = await saveSettings({ ...settings, footer_text: 'Ownership preserved.' });
    expect(put.status, JSON.stringify(put.body)).toBe(200);

    const after = await get("SELECT value, updated_at FROM settings WHERE key = 'logo_path'");
    expect(after.value).toBe(before.value);
    // Untouched: the save must not write the row at all.
    expect(after.updated_at).toBe(before.updated_at);
  });

  it('refuses a client-supplied change to logo_path', async () => {
    const settings = await loadSettings();
    const original = settings.logo_path;

    const res = await saveSettings({ ...settings, logo_path: 'branding/attacker-controlled.png' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(pathsOf(res)).toContain('logo_path');

    // Nothing was written.
    expect((await loadSettings()).logo_path).toBe(original);
  });

  it('refuses a path-traversal attempt in logo_path', async () => {
    const settings = await loadSettings();
    const original = settings.logo_path;

    const res = await saveSettings({ ...settings, logo_path: '../../../../etc/passwd' });
    expect(res.status).toBe(400);
    expect(pathsOf(res)).toContain('logo_path');
    expect((await loadSettings()).logo_path).toBe(original);
  });

  it('refuses a client-supplied change to favicon_path', async () => {
    const settings = await loadSettings();

    const res = await saveSettings({ ...settings, favicon_path: 'branding/evil.ico' });
    expect(res.status).toBe(400);
    expect(pathsOf(res)).toContain('favicon_path');
    expect((await loadSettings()).favicon_path).toBe('');
  });

  it('still rejects settings keys that are neither editable nor already stored', async () => {
    const settings = await loadSettings();
    const res = await saveSettings({ ...settings, totally_made_up_key: 'x' });
    expect(res.status).toBe(400);
    expect(pathsOf(res)).toContain('totally_made_up_key');
    expect(messagesOf(res).join(' ')).toMatch(/Unknown setting/i);
  });

  // ---------------------------------------------------------------------
  // 4. All existing validation rules
  // ---------------------------------------------------------------------
  it('still enforces every existing validation rule', async () => {
    const invalid: Array<Record<string, unknown>> = [
      { primary_color: 'blue' },
      { secondary_color: '#12345' },
      { contact_email: 'not-an-email' },
      { support_email: 'not-an-email' },
      { website_url: 'ftp://example.com' },
      { site_title: '   ' },
      { agency_name: 42 },
      { whatsapp_enabled: 'yes' },
      { require_receipt_upload: 1 },
      { invoice_due_days_default: 9999 },
      { invoice_due_days_default: 0 },
      { payment_deadline_reminder_days: -1 },
      { payment_deadline_reminder_days: 61 },
      { receipt_max_size_mb: 500 },
      { receipt_max_size_mb: 0 },
      { invoice_ref_prefix: '9bad' },
      { invoice_ref_prefix: 'WAY_TOO_LONG_PREFIX' },
      { transaction_ref_prefix: 'has space' },
      { allowed_receipt_types: [] },
      { allowed_receipt_types: ['exe'] },
      { allowed_receipt_types: 'pdf' },
      { client_workflow: 'nope' },
      { client_workflow: [] },
      { notification_templates: [] },
      { notification_templates: 'nope' },
    ];

    for (const patch of invalid) {
      const res = await admin.put('/api/admin/settings').send({ settings: patch });
      expect(res.status, `expected 400 for ${JSON.stringify(patch)}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.error.code).toBe('validation_error');
      // Each failure names the offending field.
      const paths = pathsOf(res);
      expect(paths.length, `expected a field path for ${JSON.stringify(patch)}`).toBeGreaterThan(0);
      for (const p of paths) {
        expect(typeof p, `path for ${JSON.stringify(patch)} must be a field name`).toBe('string');
        expect(p.length).toBeGreaterThan(0);
      }
    }
  });

  it('reports every invalid field at once, not just the first', async () => {
    const res = await admin
      .put('/api/admin/settings')
      .send({ settings: { primary_color: 'blue', invoice_ref_prefix: '9bad', contact_email: 'nope' } });
    expect(res.status).toBe(400);
    const paths = pathsOf(res);
    expect(paths).toContain('primary_color');
    expect(paths).toContain('invoice_ref_prefix');
    expect(paths).toContain('contact_email');
    expect(messagesOf(res).length).toBe(3);
  });

  it('accepts valid values for every editable setting', async () => {
    const res = await admin.put('/api/admin/settings').send({
      settings: {
        agency_name: 'Atlas Migration Services',
        site_title: 'Atlas Payment Portal',
        contact_email: 'hello@atlas.example',
        contact_phone: '+234 800 000 0000',
        whatsapp_number: '+234 800 000 0001',
        whatsapp_enabled: true,
        office_address: '12 Embassy Row, Abuja',
        website_url: 'https://atlas.example',
        primary_color: '#0b5fff',
        secondary_color: '#06255c',
        login_heading: 'Client sign in',
        login_description: 'Use your name and access code.',
        welcome_message: 'Welcome to Atlas.',
        footer_text: 'Atlas Migration Services',
        terms_and_conditions: 'Terms body',
        privacy_policy: 'Privacy body',
        refund_policy: 'Refund body',
        payment_instructions: 'Instructions body',
        payment_disclaimer: 'Disclaimer body',
        support_email: 'help@atlas.example',
        support_phone: '+234 800 000 0002',
        invoice_ref_prefix: 'inv',
        transaction_ref_prefix: 'pay',
        invoice_due_days_default: 21,
        payment_deadline_reminder_days: 5,
        receipt_max_size_mb: 8,
        allowed_receipt_types: ['pdf', 'png'],
        require_receipt_upload: true,
        require_sender_name: false,
        require_transfer_reference: true,
        client_workflow: {
          allow_partial_payments: false,
          allow_method_change_before_confirm: true,
          show_instructions_snapshot: true,
        },
        notification_templates: {
          client_created: { subject: 'Welcome', body: 'Hello {{client_name}}' },
        },
        notify_on_confirmation_submitted: true,
        notify_on_payment_approved: true,
        notify_on_payment_rejected: false,
        notify_on_invoice_created: true,
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const after = await loadSettings();
    expect(after.agency_name).toBe('Atlas Migration Services');
    // Ref prefixes are normalised to upper case (existing behaviour).
    expect(after.invoice_ref_prefix).toBe('INV');
    expect(after.transaction_ref_prefix).toBe('PAY');
    expect(after.invoice_due_days_default).toBe(21);
    expect(after.allowed_receipt_types).toEqual(['pdf', 'png']);
    expect(after.client_workflow.allow_partial_payments).toBe(false);
    // Unspecified templates keep their defaults rather than being dropped.
    expect(after.notification_templates.invoice_created.subject).toBeTruthy();
    expect(after.notification_templates.client_created.subject).toBe('Welcome');
  });

  it('validates the preview endpoint with the same rules as the save', async () => {
    const settings = await loadSettings();
    const ok = await admin
      .post('/api/admin/settings/preview')
      .send({ settings: { ...settings, agency_name: 'Preview Only Agency' } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.persisted).toBe(false);
    expect(ok.body.preview.agencyName).toBe('Preview Only Agency');

    // Preview must not persist anything.
    expect((await loadSettings()).agency_name).not.toBe('Preview Only Agency');

    // A storage-path change is refused by preview too.
    const bad = await admin
      .post('/api/admin/settings/preview')
      .send({ settings: { ...settings, logo_path: 'branding/sneaky.png' } });
    expect(bad.status).toBe(400);
    expect(pathsOf(bad)).toContain('logo_path');
  });

  // ---------------------------------------------------------------------
  // 6. Legacy settings values
  // ---------------------------------------------------------------------
  describe('legacy settings rows', () => {
    const LEGACY_KEY = 'legacy_sms_footer';

    afterAll(async () => {
      await run('DELETE FROM settings WHERE key = ?', [LEGACY_KEY]);
    });

    it('round-trips a legacy key still present in the key/value table', async () => {
      // The settings table is a generic key/value store, so a value written by
      // an older release can outlive the editable schema. GET returns it, so a
      // faithful round-trip must not fail because of it.
      await run(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [LEGACY_KEY, JSON.stringify('Sent by SMS'), isoNow()]
      );

      const settings = await loadSettings();
      expect(settings[LEGACY_KEY]).toBe('Sent by SMS');

      const put = await saveSettings({ ...settings, agency_name: 'Legacy Friendly Agency' });
      expect(put.status, JSON.stringify(put.body)).toBe(200);

      const after = await loadSettings();
      expect(after[LEGACY_KEY]).toBe('Sent by SMS');
      expect(after.agency_name).toBe('Legacy Friendly Agency');
    });

    it('refuses a client-supplied change to a legacy key', async () => {
      const settings = await loadSettings();
      const res = await saveSettings({ ...settings, [LEGACY_KEY]: 'Hijacked' });
      expect(res.status).toBe(400);
      expect(pathsOf(res)).toContain(LEGACY_KEY);
      expect((await loadSettings())[LEGACY_KEY]).toBe('Sent by SMS');
    });
  });

  it('records an audit event listing only the keys actually written', async () => {
    const settings = await loadSettings();
    const put = await saveSettings({ ...settings, footer_text: 'Audited footer' });
    expect(put.status).toBe(200);

    const row = await get(
      "SELECT details FROM audit_logs WHERE action = 'settings_updated' ORDER BY id DESC LIMIT 1"
    );
    expect(row).toBeTruthy();
    const details = JSON.parse(row.details);
    expect(details.keys).toContain('footer_text');
    // Server-managed paths are not written, so they are not reported as updated.
    expect(details.keys).not.toContain('logo_path');
    expect(details.keys).not.toContain('favicon_path');
  });
});
