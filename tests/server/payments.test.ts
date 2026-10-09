import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashSecret } from '../../server/security/passwords';
import {
  ADMIN_NEW_PASSWORD,
  BOOTSTRAP_EMAIL,
  CLIENT_CODE,
  CLIENT_NAME,
  JPEG_BYTES,
  PNG_BYTES,
  adminLogin,
  call,
  clientCall,
  clientLogin,
  confirmationForm,
  createTestEnv,
  seedPortal,
  tokenFromMessage,
  uuid,
  type TestEnv,
} from './helpers';

type Seed = Awaited<ReturnType<typeof seedPortal>>;

describe('client payment references and card handling', () => {
  let env: TestEnv;
  let seed: Seed;

  beforeAll(async () => {
    env = await createTestEnv();
    seed = await seedPortal(env);
  });
  afterAll(async () => {
    await env.cleanup();
  });

  it('shows card as disabled with the exact label and no card fields', async () => {
    const res = await clientCall(env, `/api/client/invoices/${seed.invoiceId}`, seed.client);
    expect(res.status).toBe(200);
    const card = res.body.options.methods.find((m: { method: string }) => m.method === 'card');
    expect(card.available).toBe(false);
    expect(card.label).toBe('Not available in your region');
    const serialized = JSON.stringify(res.body).toLowerCase();
    expect(serialized).not.toContain('cvv');
    expect(serialized).not.toContain('card number');
  });

  it('refuses to issue a card reference and refuses to enable card payments', async () => {
    const card = await clientCall(env, `/api/client/invoices/${seed.invoiceId}/references`, seed.client, {
      json: { currency: 'USD', method: 'card' },
      headers: { 'idempotency-key': uuid() },
    });
    expect(card.status).toBe(422);
    const enable = await call(env, '/api/admin/payment-config/methods/card', { session: seed.admin, method: 'PUT', json: { enabled: true } });
    expect(enable.status).toBe(409);
  });

  it('refuses a client-supplied amount when partial payments are not allowed, and calculates the full amount on the server', async () => {
    const refused = await clientCall(env, `/api/client/invoices/${seed.invoiceId}/references`, seed.client, {
      json: { currency: 'USD', method: 'bank_transfer', bankProfileId: seed.bankProfileId, amount: '1.00' },
      headers: { 'idempotency-key': uuid() },
    });
    expect(refused.status).toBe(422);
    expect(JSON.stringify(refused.body)).toMatch(/amount|partial/i);
    const res = await clientCall(env, `/api/client/invoices/${seed.invoiceId}/references`, seed.client, {
      json: { currency: 'USD', method: 'bank_transfer', bankProfileId: seed.bankProfileId },
      headers: { 'idempotency-key': uuid() },
    });
    expect(res.status).toBe(201);
    expect(res.body.reference.amount).toBe('1000.00');
    expect(res.body.reference.instructions.bank.fields.map((f: { key: string }) => f.key)).toContain('routing_number');
  });

  it('replays the same reference for the same idempotency key and rejects a malformed key', async () => {
    const key = uuid();
    const first = await clientCall(env, `/api/client/invoices/${seed.invoiceId}/references`, seed.client, {
      json: { currency: 'USD', method: 'bank_transfer', bankProfileId: seed.bankProfileId },
      headers: { 'idempotency-key': key },
    });
    const replay = await clientCall(env, `/api/client/invoices/${seed.invoiceId}/references`, seed.client, {
      json: { currency: 'USD', method: 'bank_transfer', bankProfileId: seed.bankProfileId },
      headers: { 'idempotency-key': key },
    });
    expect(first.body.created).toBe(true);
    expect(replay.body.created).toBe(false);
    expect(replay.body.reference.id).toBe(first.body.reference.id);
    const bad = await clientCall(env, `/api/client/invoices/${seed.invoiceId}/references`, seed.client, {
      json: { currency: 'USD', method: 'bank_transfer', bankProfileId: seed.bankProfileId },
      headers: { 'idempotency-key': 'not-a-uuid' },
    });
    expect(bad.status).toBe(400);
  });

  it('never lets a client pay in a different currency', async () => {
    const res = await clientCall(env, `/api/client/invoices/${seed.invoiceId}/references`, seed.client, {
      json: { currency: 'EUR', method: 'bank_transfer', bankProfileId: seed.bankProfileId },
      headers: { 'idempotency-key': uuid() },
    });
    expect(res.status).toBe(422);
  });
});

describe('confirmations, verification, refunds and cancellation', () => {
  let env: TestEnv;
  let seed: Seed;

  const issueReference = async (amount = '1000.00') => {
    const ref = await clientCall(env, `/api/client/invoices/${seed.invoiceId}/references`, seed.client, {
      json: { currency: 'USD', method: 'bank_transfer', bankProfileId: seed.bankProfileId, amount },
      headers: { 'idempotency-key': uuid() },
    });
    expect(ref.status).toBe(201);
    return ref.body.reference as { id: string; reference: string };
  };
  const submit = (referenceId: string, overrides: Record<string, string> = {}, receipt?: Parameters<typeof confirmationForm>[1], key = uuid()) =>
    clientCall(env, `/api/client/references/${referenceId}/submissions`, seed.client, {
      form: confirmationForm(overrides, receipt),
      headers: { 'idempotency-key': key },
    });
  const submissionFor = async (reference: string) => {
    const list = await call(env, '/api/admin/submissions', { session: seed.admin });
    const row = list.body.submissions.find((s: { reference: string }) => s.reference === reference);
    if (!row) throw new Error(`no submission for ${reference}`);
    return row.id as string;
  };

  beforeAll(async () => {
    env = await createTestEnv();
    seed = await seedPortal(env, { partialPaymentsAllowed: true });
  });
  afterAll(async () => {
    await env.cleanup();
  });

  it('records a confirmation without marking the invoice paid', async () => {
    const ref = await issueReference();
    const res = await submit(ref.id);
    expect(res.status).toBe(201);
    const invoice = await clientCall(env, `/api/client/invoices/${seed.invoiceId}`, seed.client);
    expect(invoice.body.invoice.status).toBe('confirmation_submitted');
    expect(invoice.body.invoice.paid).toBe('0');
    expect(JSON.stringify(invoice.body)).not.toMatch(/payment successful/i);
    expect(res.body.reference.canSubmitConfirmation).toBe(false);
  });

  it('replays the same submission for the same idempotency key and refuses a second open confirmation', async () => {
    const ref = await issueReference();
    const key = uuid();
    const first = await submit(ref.id, {}, undefined, key);
    const replay = await submit(ref.id, {}, undefined, key);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.submissionId).toBe(first.body.submissionId);
    const second = await submit(ref.id);
    expect(second.status).toBe(409);
  });

  it('rejects a file whose content does not match its declared type', async () => {
    const ref = await issueReference();
    const fake = await submit(ref.id, { transferReference: 'FAKE-1' }, { bytes: new TextEncoder().encode('this is not a pdf'), type: 'application/pdf', name: 'receipt.pdf' });
    expect(fake.status).toBe(422);
    expect(JSON.stringify(fake.body)).toMatch(/receipt/i);
  });

  it('accepts PNG and JPEG receipts and refuses files over the size limit', async () => {
    const png = await submit((await issueReference()).id, { transferReference: 'PNG-1' }, { bytes: PNG_BYTES, type: 'image/png', name: 'receipt.png' });
    expect(png.status).toBe(201);
    const jpeg = await submit((await issueReference()).id, { transferReference: 'JPG-1' }, { bytes: JPEG_BYTES, type: 'image/jpeg', name: 'receipt.jpg' });
    expect(jpeg.status).toBe(201);
    const big = new Uint8Array(6 * 1024 * 1024);
    big.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const tooBig = await submit((await issueReference()).id, { transferReference: 'BIG-1' }, { bytes: big, type: 'application/pdf', name: 'big.pdf' });
    expect(tooBig.status).toBe(413);
  }, 60_000);

  it('keeps receipts private: anonymous requests fail and another client cannot read them', async () => {
    const ref = await issueReference();
    const sent = await submit(ref.id, { transferReference: 'PRIVATE-1' });
    expect(sent.status).toBe(201);
    const detail = await clientCall(env, `/api/client/references/${ref.id}`, seed.client);
    const receiptId = detail.body.reference.submissions[0].receipts[0].id as string;
    const anonymous = await call(env, `/api/client/receipts/${receiptId}`);
    expect(anonymous.status).toBe(401);
    const other = await call(env, '/api/admin/clients', { session: seed.admin, json: { fullName: 'Bola Adeyemi', email: 'bola@example.test', phone: '' } });
    const inv = await call(env, `/api/admin/clients/${other.body.client.id}/invitation`, { session: seed.admin, json: {} });
    await call(env, '/api/client/auth/activation/complete', { json: { token: tokenFromMessage(inv.body.activationUrl), accessCode: 'another-access-code' } });
    const otherSession = await clientLogin(env, 'Bola Adeyemi', 'another-access-code');
    const crossRead = await clientCall(env, `/api/client/receipts/${receiptId}`, otherSession);
    expect(crossRead.status).toBe(404);
    const adminRead = await env.app.request(`http://localhost:5173/api/admin/receipts/${receiptId}`, {
      headers: { cookie: `pp_admin_session=${seed.admin.cookie}`, host: 'localhost:5173' },
    });
    expect(adminRead.status).toBe(200);
  });

  it('refuses verification from a viewer, and verification needs the confirmation flag and a sane amount', async () => {
    const ref = await issueReference();
    await submit(ref.id, { transferReference: 'VERIFY-GATE' });
    const submissionId = await submissionFor(ref.reference);
    await call(env, `/api/admin/submissions/${submissionId}/start-review`, { session: seed.admin, json: {} });
    const hash = await hashSecret('viewer-passphrase-2026');
    await env.deps.db.query(
      `INSERT INTO admin_users (id, email, display_name, role, status, password_hash, must_change_password, created_at, updated_at)
       VALUES ($1, 'viewer@example.test', 'Viewer', 'viewer', 'active', $2, false, now(), now())`,
      [uuid(), hash],
    );
    const viewer = await adminLogin(env, 'viewer@example.test', 'viewer-passphrase-2026');
    const denied = await call(env, `/api/admin/submissions/${submissionId}/verify`, { session: viewer, json: { verifiedAmount: '1000.00', confirm: true, note: '' } });
    expect(denied.status).toBe(403);
    const noConfirm = await call(env, `/api/admin/submissions/${submissionId}/verify`, { session: seed.admin, json: { verifiedAmount: '1000.00', confirm: false, note: '' } });
    expect(noConfirm.status).toBe(422);
    const tooMuch = await call(env, `/api/admin/submissions/${submissionId}/verify`, { session: seed.admin, json: { verifiedAmount: '5000.00', confirm: true, note: '' } });
    expect(tooMuch.status).toBe(422);
    const invoiceStill = await clientCall(env, `/api/client/invoices/${seed.invoiceId}`, seed.client);
    expect(invoiceStill.body.invoice.status).not.toBe('payment_verified');
  });

  it('requires a real reason to reject a confirmation', async () => {
    const ref = await issueReference();
    await submit(ref.id, { transferReference: 'REJECT-1' });
    const submissionId = await submissionFor(ref.reference);
    const short = await call(env, `/api/admin/submissions/${submissionId}/reject`, { session: seed.admin, json: { reason: 'no' } });
    expect(short.status).toBe(422);
    const detail = await call(env, `/api/admin/submissions/${submissionId}`, { session: seed.admin });
    expect(['submitted', 'under_review']).toContain(detail.body.status);
  });

  it('verifies with the confirmation flag, then records refunds only with explicit manual confirmation', async () => {
    const ref = await issueReference();
    await submit(ref.id, { transferReference: 'PAID-1' });
    const submissionId = await submissionFor(ref.reference);
    const verified = await call(env, `/api/admin/submissions/${submissionId}/verify`, { session: seed.admin, json: { verifiedAmount: '1000.00', confirm: true, note: 'Matched statement' } });
    expect(verified.status).toBe(200);
    const invoice = await clientCall(env, `/api/client/invoices/${seed.invoiceId}`, seed.client);
    expect(invoice.body.invoice.status).toBe('payment_verified');
    const refundNoConfirm = await call(env, `/api/admin/invoices/${seed.invoiceId}/refunds`, { session: seed.admin, json: { currency: 'USD', amount: '100.00', transferReference: 'RF-1', confirmManual: false, note: '' } });
    expect(refundNoConfirm.status).toBe(422);
    const refundTooMuch = await call(env, `/api/admin/invoices/${seed.invoiceId}/refunds`, { session: seed.admin, json: { currency: 'USD', amount: '50000.00', transferReference: 'RF-2', confirmManual: true, note: '' } });
    expect(refundTooMuch.status).toBe(422);
    const refund = await call(env, `/api/admin/invoices/${seed.invoiceId}/refunds`, { session: seed.admin, json: { currency: 'USD', amount: '100.00', transferReference: 'RF-3', confirmManual: true, note: 'Client request' } });
    expect(refund.status).toBe(201);
    const after = await call(env, `/api/admin/invoices/${seed.invoiceId}`, { session: seed.admin });
    expect(after.body.invoice.netPaid).toBe('900.00');
  });

  it('blocks cancellation of an invoice that has ledger entries', async () => {
    const res = await call(env, `/api/admin/invoices/${seed.invoiceId}/cancel`, { session: seed.admin, json: { reason: 'Duplicate invoice', confirm: true } });
    expect(res.status).toBe(409);
  });

  it('keeps the audit log append-only at the database level', async () => {
    await expect(env.deps.db.query("UPDATE audit_events SET summary = 'changed'")).rejects.toThrow();
    await expect(env.deps.db.query('DELETE FROM audit_events')).rejects.toThrow();
  });
});

describe('client sign-in and invitation rules', () => {
  let env: TestEnv;
  let seed: Seed;

  beforeAll(async () => {
    env = await createTestEnv();
    seed = await seedPortal(env);
  });
  afterAll(async () => {
    await env.cleanup();
  });

  it('requires the access code and gives the same generic failure for unknown names and wrong codes', async () => {
    const nameOnly = await call(env, '/api/client/auth/login', { json: { fullName: CLIENT_NAME, accessCode: '' } });
    expect(nameOnly.status).toBe(422);
    const wrongCode = await call(env, '/api/client/auth/login', { json: { fullName: CLIENT_NAME, accessCode: 'wrong-code-value' } });
    const unknown = await call(env, '/api/client/auth/login', { json: { fullName: 'Nobody Here', accessCode: 'wrong-code-value' } });
    expect(wrongCode.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrongCode.body.error.message).toBe(unknown.body.error.message);
  });

  it('accepts the name in any capitalisation or spacing with the right access code', async () => {
    const res = await call(env, '/api/client/auth/login', { json: { fullName: '  amina   YUSUF ', accessCode: CLIENT_CODE } });
    expect(res.status).toBe(200);
  });

  it('refuses a reused activation link', async () => {
    const other = await call(env, '/api/admin/clients', { session: seed.admin, json: { fullName: 'Chidi Okafor', email: 'chidi@example.test', phone: '' } });
    const inv = await call(env, `/api/admin/clients/${other.body.client.id}/invitation`, { session: seed.admin, json: {} });
    const token = tokenFromMessage(inv.body.activationUrl);
    const first = await call(env, '/api/client/auth/activation/complete', { json: { token, accessCode: 'chidi-access-2026' } });
    const second = await call(env, '/api/client/auth/activation/complete', { json: { token, accessCode: 'chidi-access-2026' } });
    expect(first.status).toBe(200);
    expect(second.status).not.toBe(200);
  });

  it('blocks a suspended client from signing in', async () => {
    await call(env, `/api/admin/clients/${seed.clientId}/status`, { session: seed.admin, json: { status: 'suspended' } });
    const res = await call(env, '/api/client/auth/login', { json: { fullName: CLIENT_NAME, accessCode: CLIENT_CODE } });
    expect(res.status).toBe(401);
    await call(env, `/api/admin/clients/${seed.clientId}/status`, { session: seed.admin, json: { status: 'active' } });
  });

  it('keeps the admin login email in the expected format for the bootstrap account', () => {
    expect(BOOTSTRAP_EMAIL).toBe('portal11@gmail.com');
    expect(ADMIN_NEW_PASSWORD.length).toBeGreaterThanOrEqual(12);
  });
});
