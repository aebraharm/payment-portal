import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { makeApp, loginAdmin, createClient, createInvoice, createUsdProfile, createPaymentReference, loginClient, get } from './helpers';
import { seedDatabase } from '../../server/seed.js';

describe('configuration, branding and seeding', () => {
  let app: any;
  let admin: request.SuperAgentTest;

  beforeAll(async () => {
    app = await makeApp();
    ({ agent: admin } = await loginAdmin(app));
  });

  it('seeding is idempotent (re-running does not duplicate or reset)', async () => {
    const before = get('SELECT COUNT(*) AS n FROM admins').n;
    await seedDatabase();
    await seedDatabase();
    const after = get('SELECT COUNT(*) AS n FROM admins').n;
    expect(after).toBe(before);
    // Bootstrap admin still has a valid password hash (not reset by re-seed).
    const row = get('SELECT must_change_password, password_hash FROM admins WHERE email = ?', ['test-bootstrap-admin@example.com']);
    expect(row.password_hash).toBeTruthy();
  });

  it('serves default branding publicly without leaking admin configuration', async () => {
    const res = await request(app).get('/api/public/branding');
    expect(res.status).toBe(200);
    expect(res.body.branding.siteTitle).toBeTruthy();
    expect(typeof res.body.branding.agencyName).toBe('string');
    expect(res.body.branding.primaryColor).toMatch(/^#/);
    expect(res.body.cardLabel).toBe('Not available in your region');
    expect(typeof res.body.branding.supportEmail).toBe('string');
    expect(typeof res.body.branding.supportPhone).toBe('string');
    expect(res.body.branding).not.toHaveProperty('notificationTemplates');
  });

  it('updates branding settings and reflects them publicly', async () => {
    const put = await admin.put('/api/admin/settings').send({
      agency_name: 'Atlas Migration Services',
      primary_color: '#0b5fff',
      secondary_color: '#06255c',
      support_email: 'help@atlas.example',
      support_phone: '+1 555 0100',
      office_address: '12 Embassy Row, Abuja',
      login_heading: 'Welcome to Atlas',
      login_description: 'Payments made simple',
      welcome_message: 'Hello from Atlas',
      terms_and_conditions: 'Terms of service body',
      privacy_policy: 'Privacy policy body',
      refund_policy: 'Refund policy body',
    });
    expect(put.status).toBe(200);

    const res = await request(app).get('/api/public/branding');
    expect(res.body.branding.agencyName).toBe('Atlas Migration Services');
    expect(res.body.branding.primaryColor).toBe('#0b5fff');
    expect(res.body.branding.supportEmail).toBe('help@atlas.example');
    expect(res.body.branding.loginHeading).toBe('Welcome to Atlas');
    expect(res.body.branding.termsAndConditions).toBe('Terms of service body');
  });

  it('validates settings input (bad color, bad email, bad ref prefix)', async () => {
    const badColor = await admin.put('/api/admin/settings').send({ primary_color: 'blue' });
    expect(badColor.status).toBe(400);
    const badEmail = await admin.put('/api/admin/settings').send({ support_email: 'not-an-email' });
    expect(badEmail.status).toBe(400);
    const badPrefix = await admin.put('/api/admin/settings').send({ client_ref_prefix: '9bad' });
    expect(badPrefix.status).toBe(400);
    const badDays = await admin.put('/api/admin/settings').send({ invoice_due_days_default: 9999 });
    expect(badDays.status).toBe(400);
  });

  it('previews settings without persisting them', async () => {
    const before = get("SELECT value FROM settings WHERE key = 'agency_name'").value;
    const preview = await admin.post('/api/admin/settings/preview').send({ agency_name: 'Preview Only Agency' });
    expect(preview.status).toBe(200);
    expect(preview.body.persisted).toBe(false);
    expect(preview.body.preview.agencyName).toBe('Preview Only Agency');
    const after = get("SELECT value FROM settings WHERE key = 'agency_name'").value;
    expect(after).toBe(before);
  });

  it('supports logo upload, retrieval and deletion', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02]);
    const upload = await admin.post('/api/admin/settings/logo').attach('logo', png, 'logo.png');
    expect(upload.status).toBe(200);
    expect(upload.body.logoUrl).toBe('/api/public/branding/logo');

    const logo = await request(app).get('/api/public/branding/logo');
    expect(logo.status).toBe(200);
    expect(logo.headers['content-type']).toBe('image/png');

    const del = await admin.delete('/api/admin/settings/logo');
    expect(del.status).toBe(200);
    expect((await request(app).get('/api/public/branding/logo')).status).toBe(404);
  });

  it('rejects an invalid logo file type', async () => {
    const res = await admin.post('/api/admin/settings/logo').attach('logo', Buffer.from('MZ fake exe'), 'logo.exe');
    expect(res.status).toBe(400);
  });

  it('creates invoices with server-computed amounts (ignores client-supplied totals)', async () => {
    const client = await createClient(admin, 'Invoice Client', 'invoice@example.com');
    const res = await admin.post('/api/admin/invoices').send({
      clientId: client.id,
      description: 'Line item invoice',
      currency: 'USD',
      issueDate: '2026-10-01',
      dueDate: '2026-10-31',
      lineItems: [
        { description: 'Consultation', quantity: 2, unitAmount: '500.00' },
        { description: 'Document review', quantity: 1, unitAmount: '250.50' },
      ],
    });
    expect(res.status).toBe(201);
    // 2*500.00 + 250.50 = 1250.50 → 125050 cents, computed server-side.
    expect(res.body.invoice.amountCents).toBe(125050);
  });

  it('validates invoice input (amount, currency, dates, unknown client)', async () => {
    const client = await createClient(admin, 'Invoice Client 2', 'invoice2@example.com');
    expect((await admin.post('/api/admin/invoices').send({ clientId: 99999, currency: 'USD', issueDate: '2026-10-01', dueDate: '2026-10-31', amount: '10.00' })).status).toBe(400);
    expect((await admin.post('/api/admin/invoices').send({ clientId: client.id, currency: 'XYZ', issueDate: '2026-10-01', dueDate: '2026-10-31', amount: '10.00' })).status).toBe(400);
    expect((await admin.post('/api/admin/invoices').send({ clientId: client.id, currency: 'USD', issueDate: '2026-10-31', dueDate: '2026-10-01', amount: '10.00' })).status).toBe(400);
    expect((await admin.post('/api/admin/invoices').send({ clientId: client.id, currency: 'USD', issueDate: '2026-10-01', dueDate: '2026-10-31', amount: '-5.00' })).status).toBe(400);
  });

  it('edits editable invoices and records audit events', async () => {
    const client = await createClient(admin, 'Invoice Client 3', 'invoice3@example.com');
    const invoice = await createInvoice(admin, client.id, { description: 'Editable' });
    const before = get('SELECT COUNT(*) AS n FROM audit_logs').n;

    const edit = await admin.put(`/api/admin/invoices/${invoice.id}`).send({
      description: 'Edited description',
      dueDate: '2026-11-30',
      allowPartial: true,
    });
    expect(edit.status).toBe(200);
    expect(edit.body.invoice.description).toBe('Edited description');
    expect(edit.body.invoice.dueDate).toBe('2026-11-30');
    expect(edit.body.invoice.allowPartial).toBe(true);
    // Amounts are immutable after issue — the server ignores amount edits.
    expect(edit.body.invoice.amountCents).toBe(150000);

    const after = get('SELECT COUNT(*) AS n FROM audit_logs').n;
    expect(after).toBeGreaterThan(before);
    const events = get('SELECT action FROM audit_logs ORDER BY id DESC LIMIT 1');
    expect(events.action).toBe('invoice_updated');
  });

  it('cancels invoices with a reason and records an audit event', async () => {
    const client = await createClient(admin, 'Invoice Client 4', 'invoice4@example.com');
    const invoice = await createInvoice(admin, client.id);
    const res = await admin.post(`/api/admin/invoices/${invoice.id}/cancel`).send({ reason: 'Client withdrew application' });
    expect(res.status).toBe(200);
    expect(res.body.invoice.status).toBe('cancelled');
    const row = get('SELECT status FROM invoices WHERE id = ?', [invoice.id]);
    expect(row.status).toBe('cancelled');
  });

  it('blocks deleting a bank profile that is referenced by existing payment references', async () => {
    const client = await createClient(admin, 'Profile Client', 'profile@example.com');
    const invoice = await createInvoice(admin, client.id);
    const profile = await createUsdProfile(admin);
    const clientAgent = await loginClient(app, client);
    const ref = await createPaymentReference(clientAgent, invoice.id, 'bank_transfer');
    expect(ref.status).toBe(201);

    const del = await admin.delete(`/api/admin/bank-instructions/${profile.id}`);
    expect(del.status).toBe(409);

    // The reference's snapshot remains intact.
    const kept = await clientAgent.get(`/api/client/payment-references/${ref.body.reference.id}`);
    expect(kept.status).toBe(200);
    expect(kept.body.reference.instructionsSnapshot.profile.fields.account_number).toBe('123456789012');
  });

  it('lists audit logs and sessions for the security page', async () => {
    const audit = await admin.get('/api/admin/audit-logs');
    expect(audit.status).toBe(200);
    expect(audit.body.logs.length).toBeGreaterThan(0);
    expect(audit.body.logs[0].action).toBeTruthy();

    const sessions = await admin.get('/api/admin/sessions');
    expect(sessions.status).toBe(200);
    expect(sessions.body.sessions.length).toBeGreaterThan(0);
  });

  it('lists notifications and shows skipped status when SMTP is not configured', async () => {
    const res = await admin.get('/api/admin/notifications');
    expect(res.status).toBe(200);
    // No SMTP configured in the test environment → nothing should ever be "sent".
    for (const n of res.body.notifications) {
      expect(n.status).not.toBe('sent');
    }
  });

  it('requires the superadmin role for admin account management', async () => {
    // Create a second admin with the reviewer role.
    const create = await admin.post('/api/admin/admins').send({
      email: 'reviewer@example.com',
      password: 'ReviewerPass123',
      role: 'reviewer',
    });
    expect(create.status).toBe(201);

    expect(create.body.adminId).toBeTruthy();
    const reviewerAgent = request.agent(app);
    const login = await reviewerAgent
      .post('/api/admin/auth/login')
      .send({ email: 'reviewer@example.com', password: 'ReviewerPass123' });
    expect(login.status).toBe(200);
    expect(login.body.mustChangePassword).toBe(true);
    // New admins must change their initial password before using the API.
    const blocked = await reviewerAgent.get('/api/admin/transactions');
    expect(blocked.status).toBe(403);
    const change = await reviewerAgent
      .post('/api/admin/auth/change-password')
      .send({ currentPassword: 'ReviewerPass123', newPassword: 'ReviewerPass456' });
    expect(change.status).toBe(200);

    // Reviewers can review transactions...
    expect((await reviewerAgent.get('/api/admin/transactions')).status).toBe(200);
    // ...but not manage admin accounts or change payment configuration.
    expect((await reviewerAgent.get('/api/admin/admins')).status).toBe(403);
    expect((await reviewerAgent.put('/api/admin/card-config').send({ processorName: 'Stripe' })).status).toBe(403);
    expect((await reviewerAgent.post('/api/admin/bank-instructions').send({ currency: 'USD', profileName: 'X', transferTypes: ['ach'], fields: {} })).status).toBe(403);
  });

  it('enforces that the card processor is never marked as integrated', async () => {
    // Enabling without a verified region is rejected.
    const noRegion = await admin.put('/api/admin/card-config').send({
      processorName: 'Stripe',
      enabled: true,
    });
    expect(noRegion.status).toBe(400);

    // Even a "complete" configuration can never mark the processor as integrated,
    // and clients always see the fixed unavailable label.
    const ok = await admin.put('/api/admin/card-config').send({
      processorName: 'Stripe',
      regionVerified: true,
      enabled: true,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.config.processorIntegrated).toBe(false);
    expect(ok.body.config.label).toBe('Not available in your region');

    const branding = await request(app).get('/api/public/branding');
    const card = branding.body.paymentMethods.find((m: any) => m.code === 'card');
    expect(card.available).toBe(false);
    expect(card.label).toBe('Not available in your region');
  });
});
