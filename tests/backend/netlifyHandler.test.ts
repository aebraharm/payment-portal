import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { handleFetch, normalizeApiPath, resetHandlerCache } from '../../server/lib/serverlessAdapter.js';
import { seedDatabase } from '../../server/seed.js';
import { closeDb } from '../../server/db.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, PNG_BUFFER } from './helpers.js';

/**
 * The Netlify Function is the same Express app reached through a fetch
 * `Request`/`Response` pair. These tests drive that pair, because the parts most
 * likely to be wrong in this layer are exactly the ones a route test cannot
 * see: the path the platform hands over, cookies coming back as *separate*
 * headers, and a binary body re-encoded as text.
 */
const BASE = 'http://portal.example.netlify.app';
const ADMIN_WORKING_PASSWORD = 'AdapterPass123';

async function viaHandler(path: string, init: RequestInit = {}) {
  return handleFetch(new Request(new URL(path, BASE), init), { clientIp: '203.0.113.7' });
}

async function json(path: string, body: unknown, headers: Record<string, string> = {}) {
  return viaHandler(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function cookieOf(res: Response) {
  const all = res.headers.getSetCookie();
  const session = all.find((c) => /=(admin|client)_session=/.test(c)) ?? all[0];
  return session ? session.split(';')[0] : '';
}

async function adminCookie() {
  let login = await json('/api/admin/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (login.status !== 200) throw new Error(`admin login failed: ${login.status} ${await login.text()}`);
  const first = await login.json();
  if (first.mustChangePassword) {
    await json('/api/admin/auth/change-password', { currentPassword: ADMIN_PASSWORD, newPassword: ADMIN_WORKING_PASSWORD }, {
      cookie: cookieOf(login),
    });
    login = await json('/api/admin/auth/login', { email: ADMIN_EMAIL, password: ADMIN_WORKING_PASSWORD });
  }
  return cookieOf(login);
}

beforeAll(async () => {
  await seedDatabase();
  resetHandlerCache();
});

afterAll(async () => {
  await closeDb();
});

describe('normalizeApiPath — how the host names the request', () => {
  it('accepts the public path', () => {
    expect(normalizeApiPath('/api/health')).toBe('/api/health');
    expect(normalizeApiPath('/api/admin/clients/12')).toBe('/api/admin/clients/12');
  });

  it('accepts the rewritten function path', () => {
    expect(normalizeApiPath('/.netlify/functions/api/health')).toBe('/api/health');
    expect(normalizeApiPath('/.netlify/functions/api/admin/clients/12')).toBe('/api/admin/clients/12');
    expect(normalizeApiPath('/.netlify/functions/api')).toBe('/api');
  });

  it('is immune to a trailing slash and to an empty remainder', () => {
    expect(normalizeApiPath('/api/health/')).toBe('/api/health');
    expect(normalizeApiPath('/')).toBe('/api');
  });
});

describe('API over the Netlify function handler', () => {
  it('serves JSON and never the SPA shell', async () => {
    const res = await viaHandler('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect((await res.json()).status).toBe('ok');
  });

  it('keeps a missing endpoint a JSON 404 from the API stack', async () => {
    const res = await viaHandler('/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'not_found' } });
  });

  it('authenticates an administrator and returns a usable session cookie', async () => {
    const res = await json('/api/admin/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    expect((await res.json()).admin.role).toBe('superadmin');

    const cookies = res.headers.getSetCookie();
    const session = cookies.find((c) => c.startsWith('admin_session='));
    expect(session).toBeDefined();
    // These attributes have to survive the adapter. Without HttpOnly an XSS can
    // read the token; without SameSite=Strict a cross-site form can send it.
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=Strict/i);
    expect(session).toMatch(/Path=\//i);
    // Revocable server-side sessions are the whole auth model, so the token
    // itself must be present and non-empty.
    expect(session!.split(';')[0]!.split('=')[1]!.length).toBeGreaterThan(20);

    const me = await viaHandler('/api/admin/auth/me', { headers: { cookie: session!.split(';')[0] } });
    expect(me.status).toBe(200);
    expect((await me.json()).admin.email).toBe(ADMIN_EMAIL);
  });

  it('rejects bad credentials with the same JSON error shape', async () => {
    const res = await json('/api/admin/auth/login', { email: ADMIN_EMAIL, password: 'not-the-password' });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: 'unauthorized' } });
  });

  it('blocks a cross-origin state-changing request', async () => {
    const res = await viaHandler('/api/admin/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'csrf_blocked' } });
  });

  it('applies the security headers the app sets', async () => {
    const res = await viaHandler('/api/health');
    expect(res.headers.get('content-security-policy')).toMatch(/frame-ancestors 'none'/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-powered-by')).toBeNull();
  });
});

describe('full payment workflow over the handler', () => {
  const unique = 'Adapter';
  let admin: string;
  let clientCookie = '';
  let invoiceId = 0;
  let confirmationId = 0;
  let receiptId = 0;
  let png = Buffer.alloc(0);

  beforeAll(async () => {
    admin = await adminCookie();

    const client = await json(
      '/api/admin/clients',
      { fullName: `Ada ${unique}`, email: `ada.${unique}@example.com` },
      { cookie: admin }
    );
    expect(client.status).toBe(201);
    const clientBody = await client.json();
    const accessCode = clientBody.accessCode;
    const clientId = clientBody.client.id;
    // The one-time code is shown exactly once, in the creation response.
    expect(typeof accessCode).toBe('string');
    expect(accessCode).toHaveLength(8);

    const profile = await json(
      '/api/admin/bank-instructions',
      {
        currency: 'USD',
        profileName: 'Adapter USD account',
        transferTypes: ['ach'],
        fields: {
          beneficiary_name: 'Global Visa Consultants Ltd',
          bank_name: 'First National Bank',
          account_number: '123456789012',
          routing_number: '021000021',
          swift_bic: 'FNBKUS33',
        },
      },
      { cookie: admin }
    );
    expect(profile.status).toBe(201);

    const invoice = await json(
      '/api/admin/invoices',
      {
        clientId,
        description: 'Visa application processing',
        amount: '1500.00',
        currency: 'USD',
        issueDate: '2026-10-01',
        dueDate: '2026-10-31',
      },
      { cookie: admin }
    );
    expect(invoice.status).toBe(201);
    invoiceId = (await invoice.json()).invoice.id;

    const login = await json('/api/client/auth/login', { fullName: `Ada ${unique}`, accessCode });
    expect(login.status).toBe(200);
    clientCookie = cookieOf(login);
  }, 60000);

  it('filters a list through a query string and paginates', async () => {
    const res = await viaHandler('/api/admin/clients?q=Ada%20Adapter&page=1&pageSize=5', { headers: { cookie: admin } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.clients.some((c: { fullName: string }) => c.fullName === 'Ada Adapter')).toBe(true);
  });

  it('requires a payment reference before a confirmation exists', async () => {
    const res = await json('/api/client/payment-references', { invoiceId, method: 'bank_transfer', currency: 'USD' }, {
      cookie: clientCookie,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.reference.status).toBe('issued');
    // Instructions are frozen into a snapshot at issue time, so a later change to
    // the bank profile cannot rewrite what the client was told to pay.
    expect(body.reference.instructionsSnapshot.profile.fields.beneficiary_name).toBe('Global Visa Consultants Ltd');

    const invoiceNow = await viaHandler(`/api/client/invoices/${invoiceId}`, { headers: { cookie: clientCookie } });
    // Issuing instructions moves the invoice to awaiting_payment but never to paid.
    expect((await invoiceNow.json()).invoice.status).toBe('awaiting_payment');
  });

  it('accepts a confirmation with a receipt and keeps it pending', async () => {
    const invoiceDetail = await viaHandler(`/api/client/invoices/${invoiceId}`, { headers: { cookie: clientCookie } });
    expect(invoiceDetail.status).toBe(200);
    const detail = await invoiceDetail.json();
    expect(detail.references).toHaveLength(1);
    const referenceId = detail.references[0].id;
    expect(detail.invoice.status).toBe('awaiting_payment');

    const form = new FormData();
    form.set('paymentReferenceId', String(referenceId));
    form.set('sentDate', '2026-10-09');
    form.set('amountSent', '1500.00');
    form.set('currency', 'USD');
    form.set('method', 'bank_transfer');
    form.set('senderName', 'Ada Adapter');
    form.set('transferReference', 'ACH-ADAPTER-0001');
    // Bytes that are not valid UTF-8, on purpose.
    png = Buffer.concat([
      PNG_BUFFER,
      Buffer.from([0xc3, 0x28, 0xe2, 0x82, 0xac, 0x00, 0xff, 0xfe, 0x80, 0xb5]),
    ]);
    form.set('receipt', new Blob([png], { type: 'image/png' }), 'receipt.png');

    const submitted = await viaHandler('/api/client/confirmations', {
      method: 'POST',
      body: form,
      headers: { cookie: clientCookie },
    });
    expect(submitted.status).toBe(201);
    const body = await submitted.json();
    expect(body.confirmation.status).toBe('submitted');
    confirmationId = body.confirmation.id;
  });

  it('serves the stored receipt back byte for byte (binary safety)', async () => {
    const detail = await viaHandler(`/api/client/confirmations/${confirmationId}`, { headers: { cookie: clientCookie } });
    expect(detail.status).toBe(200);
    const body = await detail.json();
    expect(body.confirmation.status).toBe('submitted');
    expect(body.receipts).toHaveLength(1);
    receiptId = body.receipts[0].id;

    const download = await viaHandler(`/api/files/receipts/${receiptId}`, { headers: { cookie: clientCookie } });
    expect(download.status).toBe(200);
    expect(download.headers.get('content-type')).toBe('image/png');
    expect(download.headers.get('cache-control')).toBe('private, no-store');
    const bytes = Buffer.from(await download.arrayBuffer());
    // A response re-encoded as text keeps its status, type and length and only
    // changes the bytes, so this comparison is the actual test.
    expect(bytes.length).toBe(png.length);
    expect(bytes.equals(png)).toBe(true);
  });

  it('refuses the receipt to another client and to an anonymous visitor', async () => {
    const other = await json('/api/admin/clients', { fullName: 'Mallory Adapter', email: 'mallory@example.com' }, {
      cookie: admin,
    });
    const otherCode = (await other.json()).accessCode;
    const otherLogin = await json('/api/client/auth/login', { fullName: 'Mallory Adapter', accessCode: otherCode });
    const otherCookie = cookieOf(otherLogin);

    const asOther = await viaHandler(`/api/files/receipts/${receiptId}`, { headers: { cookie: otherCookie } });
    expect(asOther.status).toBe(403);
    expect(await asOther.json()).toMatchObject({ error: { code: 'forbidden' } });

    const anonymous = await viaHandler(`/api/files/receipts/${receiptId}`);
    expect(anonymous.status).toBe(401);

    // An admin may see it: that is the review workflow.
    const asAdmin = await viaHandler(`/api/files/receipts/${receiptId}`, { headers: { cookie: admin } });
    expect(asAdmin.status).toBe(200);
  });

  it('keeps the payment pending until an administrator verifies it', async () => {
    const before = await viaHandler('/api/client/confirmations', { headers: { cookie: clientCookie } });
    expect((await before.json()).confirmations[0].status).toBe('submitted');

    // A client has no route to mark their own payment verified.
    const selfVerify = await viaHandler(`/api/admin/transactions/${confirmationId}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: clientCookie },
      body: JSON.stringify({ action: 'verified' }),
    });
    expect(selfVerify.status).toBe(401);

    const verify = await json(`/api/admin/transactions/${confirmationId}/review`, { action: 'verified' }, { cookie: admin });
    expect(verify.status).toBe(200);
    expect(await verify.json()).toEqual({ ok: true, status: 'verified' });

    const after = await viaHandler('/api/client/confirmations', { headers: { cookie: clientCookie } });
    expect((await after.json()).confirmations[0].status).toBe('verified');
    const invoiceAfter = await viaHandler(`/api/client/invoices/${invoiceId}`, { headers: { cookie: clientCookie } });
    expect((await invoiceAfter.json()).invoice.status).toBe('paid');
  });

  it('records who verified it in the audit log readable through the handler', async () => {
    const res = await viaHandler('/api/admin/audit-logs?page=1&pageSize=100', { headers: { cookie: admin } });
    expect(res.status).toBe(200);
    const body = await res.json();
    const actions: string[] = body.logs.map((e: { action: string }) => e.action);
    expect(actions).toContain('payment_verified');
    expect(actions).toContain('receipt_uploaded');
    expect(actions).toContain('client_created');

    const verifiedEntry = body.logs.find((e: { action: string }) => e.action === 'payment_verified');
    expect(JSON.parse(verifiedEntry.details).reviewer).toBe(ADMIN_EMAIL);

    // Audit rows must never carry the secrets that were in the requests.
    const raw = JSON.stringify(body.logs);
    expect(raw).not.toContain(ADMIN_WORKING_PASSWORD);
    expect(raw).not.toContain('access_code_hash');
  });
});
