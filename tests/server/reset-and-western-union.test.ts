import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_NEW_PASSWORD, BOOTSTRAP_EMAIL, adminLogin, call, clientCall, confirmationForm, createTestEnv, seedPortal, uuid, type TestEnv } from './helpers';

const linkFrom = (value: unknown): string | null => {
  const match = /#token=([A-Za-z0-9_-]+)/.exec(JSON.stringify(value));
  return match ? match[1] : null;
};

describe('administrator password reset', () => {
  let env: TestEnv;

  beforeAll(async () => {
    env = await createTestEnv();
    await seedPortal(env);
  });
  afterAll(async () => {
    await env.cleanup();
  });

  it('answers the same way for unknown addresses and sends nothing to them', async () => {
    const before = env.mailer.sent.length;
    const unknown = await call(env, '/api/admin/auth/password-reset/request', { json: { email: 'nobody@example.test' } });
    // Accepted without revealing whether the address belongs to an account.
    expect(unknown.status).toBe(202);
    expect(env.mailer.sent.length).toBe(before);
  });

  it('sends a single-use link, accepts a new password once, and then refuses the old one', async () => {
    const before = env.mailer.sent.length;
    const requested = await call(env, '/api/admin/auth/password-reset/request', { json: { email: BOOTSTRAP_EMAIL } });
    expect(requested.status).toBe(202);
    expect(env.mailer.sent.length).toBe(before + 1);
    const token = linkFrom(env.mailer.sent.at(-1));
    expect(token).not.toBeNull();
    const newPassword = `reset-${uuid()}-passphrase`;
    const confirmed = await call(env, '/api/admin/auth/password-reset/confirm', { json: { token, newPassword } });
    expect(confirmed.status).toBe(200);
    const reused = await call(env, '/api/admin/auth/password-reset/confirm', { json: { token, newPassword: `again-${uuid()}-passphrase` } });
    expect(reused.status).not.toBe(200);
    const oldLogin = await call(env, '/api/admin/auth/login', { json: { email: BOOTSTRAP_EMAIL, password: ADMIN_NEW_PASSWORD } });
    expect(oldLogin.status).toBe(401);
    const newLogin = await call(env, '/api/admin/auth/login', { json: { email: BOOTSTRAP_EMAIL, password: newPassword } });
    expect(newLogin.status).toBe(200);
  });
});

describe('Western Union: unverified until reviewed', () => {
  let env: TestEnv;
  let seed: Awaited<ReturnType<typeof seedPortal>>;

  beforeAll(async () => {
    env = await createTestEnv();
    seed = await seedPortal(env);
  });
  afterAll(async () => {
    await env.cleanup();
  });

  it('shows Western Union only once it is fully configured and enabled', async () => {
    const incompleteConfig = { displayName: 'Western Union', supportedCurrencies: ['USD'], supportedCountries: ['NG'], recipientName: '', recipientCity: '', recipientCountry: '', instructions: '', requiredSenderFields: ['sender_name'], mtcnRequirement: 'required', receiptRequirement: 'required', additionalNotes: '', clientHelpText: '', supportText: '' };
    // An incomplete configuration cannot be switched on.
    const refused = await call(env, '/api/admin/payment-config/western-union', { session: seed.admin, method: 'PUT', json: { enabled: true, config: incompleteConfig } });
    expect(refused.status).toBe(422);
    expect(JSON.stringify(refused.body)).toMatch(/recipient/i);
    // It can be saved while switched off.
    const saved = await call(env, '/api/admin/payment-config/western-union', { session: seed.admin, method: 'PUT', json: { enabled: false, config: incompleteConfig } });
    expect(saved.status).toBe(200);
    const notReady = await clientCall(env, `/api/client/invoices/${seed.invoiceId}`, seed.client);
    expect(notReady.body.options.methods.find((m: { method: string }) => m.method === 'western_union').available).toBe(false);
    const enabled = await call(env, '/api/admin/payment-config/western-union', {
      session: seed.admin,
      method: 'PUT',
      json: {
        enabled: true,
        config: {
          displayName: 'Western Union',
          supportedCurrencies: ['USD'],
          supportedCountries: ['NG'],
          recipientName: 'Agency Recipient',
          recipientCity: 'Lagos',
          recipientCountry: 'NG',
          instructions: 'Send to the recipient above and quote your reference.',
          requiredSenderFields: ['sender_name'],
          mtcnRequirement: 'required',
          receiptRequirement: 'required',
          additionalNotes: '',
          clientHelpText: '',
          supportText: '',
        },
      },
    });
    expect(enabled.status).toBe(200);
    const ready = await clientCall(env, `/api/client/invoices/${seed.invoiceId}`, seed.client);
    expect(ready.body.options.methods.find((m: { method: string }) => m.method === 'western_union').available).toBe(true);
    const config = await call(env, '/api/admin/payment-config', { session: seed.admin });
    expect(config.body.methods.western_union).toBe(true);
  });

  it('issues a Western Union reference and keeps the invoice unpaid until an authorised review verifies it', async () => {
    const ref = await clientCall(env, `/api/client/invoices/${seed.invoiceId}/references`, seed.client, {
      json: { currency: 'USD', method: 'western_union' },
      headers: { 'idempotency-key': uuid() },
    });
    if (ref.status !== 201) throw new Error(`WU reference refused: ${JSON.stringify(ref.body)}`);
    expect(ref.body.reference.instructions.westernUnion.recipientName).toBe('Agency Recipient');
    const sent = await clientCall(env, `/api/client/references/${ref.body.reference.id}/submissions`, seed.client, {
      form: confirmationForm({ method: 'western_union', transferReference: 'MTCN-TEST-1', transactionId: '1234567890' }),
      headers: { 'idempotency-key': uuid() },
    });
    expect(sent.status).toBe(201);
    const pending = await clientCall(env, `/api/client/invoices/${seed.invoiceId}`, seed.client);
    expect(pending.body.invoice.paid).toBe('0');
    expect(pending.body.invoice.status).toBe('confirmation_submitted');
    const list = await call(env, '/api/admin/submissions', { session: seed.admin });
    const row = list.body.submissions.find((s: { reference: string }) => s.reference === ref.body.reference.reference);
    expect(row.methodLabel).toMatch(/Western Union/);
    await call(env, `/api/admin/submissions/${row.id}/start-review`, { session: seed.admin, json: {} });
    const verified = await call(env, `/api/admin/submissions/${row.id}/verify`, { session: seed.admin, json: { verifiedAmount: '1000.00', confirm: true, note: 'MTCN checked' } });
    expect(verified.status).toBe(200);
    const after = await clientCall(env, `/api/client/invoices/${seed.invoiceId}`, seed.client);
    expect(after.body.invoice.status).toBe('payment_verified');
    const session = await adminLogin(env, BOOTSTRAP_EMAIL, ADMIN_NEW_PASSWORD);
    expect(session.csrf.length).toBeGreaterThan(10);
  });
});
