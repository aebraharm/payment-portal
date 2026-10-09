import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import {
  makeApp,
  loginAdmin,
  createClient,
  loginClient,
  createInvoice,
  createUsdProfile,
  createPaymentReference,
  submitConfirmation,
  get,
  all,
} from './helpers';

describe('payment workflow', () => {
  let app: any;
  let admin: request.SuperAgentTest;
  let client: any;
  let clientAgent: request.SuperAgentTest;
  let invoice: any;
  let profile: any;

  beforeAll(async () => {
    app = await makeApp();
    ({ agent: admin } = await loginAdmin(app));
    client = await createClient(admin, 'Payment Flow Client', 'payment@example.com');
    clientAgent = await loginClient(app, client);
    invoice = await createInvoice(admin, client.id, { description: 'Work permit application', amount: '2500.00' });
    profile = await createUsdProfile(admin);
  });

  // Each payment attempt needs its own invoice: once a confirmation is
  // submitted the invoice leaves the payable statuses.
  const freshInvoice = (amount = '2500.00', extra: Record<string, unknown> = {}) =>
    createInvoice(admin, client.id, { description: `Invoice ${Math.random()}`, amount, ...extra });

  it('serves only enabled payment methods, with the card option disabled and exactly labeled', async () => {
    const res = await clientAgent.get(`/api/client/payment-methods?invoiceId=${invoice.id}`);
    expect(res.status).toBe(200);
    const methods = res.body.methods;
    const card = methods.find((m: any) => m.code === 'card');
    expect(card).toBeDefined();
    expect(card.available).toBe(false);
    expect(card.label).toBe('Not available in your region');
    const bank = methods.find((m: any) => m.code === 'bank_transfer');
    expect(bank.available).toBe(true);
  });

  it('public branding exposes the exact card label', async () => {
    const res = await request(app).get('/api/public/branding');
    expect(res.body.cardLabel).toBe('Not available in your region');
    // The disabled card method is not offered as an enabled option.
    expect(res.body.paymentMethods.some((m: any) => m.code === 'card')).toBe(false);
    expect(res.body.paymentMethods.every((m: any) => m.available !== false)).toBe(true);
  });

  it('refuses card payments with the required label', async () => {
    const res = await createPaymentReference(clientAgent, invoice.id, 'card');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('Not available in your region');
  });

  it('issues a payment reference with a server-generated reference and instruction snapshot', async () => {
    const res = await createPaymentReference(clientAgent, invoice.id, 'bank_transfer');
    expect(res.status).toBe(201);
    const ref = res.body.reference;
    expect(ref.refCode).toMatch(/^PAY-\d{4}-\d{4}$/);
    expect(ref.amountCents).toBe(250000); // server-trusted amount from the invoice
    expect(ref.instructionsSnapshot.profile.fields.account_number).toBe('123456789012');
    expect(ref.instructionsSnapshot.profile.transferTypes).toContain('ach');
    // Invoice moved to awaiting_payment — NOT paid.
    const inv = await clientAgent.get(`/api/client/invoices/${invoice.id}`);
    expect(inv.body.invoice.status).toBe('awaiting_payment');
  });

  it('rejects payment for an invoice the client does not own', async () => {
    const other = await createClient(admin, 'Other Client', 'other@example.com');
    const otherAgent = await loginClient(app, other);
    const res = await otherAgent.post('/api/client/payment-references').send({ invoiceId: invoice.id, method: 'bank_transfer' });
    expect(res.status).toBe(404);
    expect((await otherAgent.get(`/api/client/invoices/${invoice.id}`)).status).toBe(404);
  });

  it('rejects currency conversion attempts (currency must match the invoice)', async () => {
    const res = await clientAgent
      .post('/api/client/payment-references')
      .send({ invoiceId: invoice.id, method: 'bank_transfer', currency: 'EUR' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('Currency conversion is not supported');
    expect(res.body.error.message).toContain('USD');
  });

  it('rejects confirmation when required fields are missing', async () => {
    const ref = await createPaymentReference(clientAgent, invoice.id, 'bank_transfer');
    expect(ref.status).toBe(201);
    // No receipt, no sender name, no transfer reference.
    const res = await clientAgent
      .post('/api/client/confirmations')
      .field('paymentReferenceId', String(ref.body.reference.id))
      .field('sentDate', '2026-10-09')
      .field('amountSent', '2500.00')
      .field('currency', 'USD')
      .field('method', 'bank_transfer');
    expect(res.status).toBe(400);
  });

  it('accepts a confirmation with a valid receipt and marks it submitted — NOT verified', async () => {
    const ref = await createPaymentReference(clientAgent, invoice.id, 'bank_transfer');
    const res = await submitConfirmation(clientAgent, ref.body.reference.id, { amountSent: '2500.00' }, 'key-basic-1');
    expect(res.status).toBe(201);
    const confirmation = res.body.confirmation;
    expect(confirmation.status).toBe('submitted');
    expect(confirmation.refCode).toBe(ref.body.reference.refCode);

    // The invoice is NOT paid — a client report is not proof of payment.
    const inv = await clientAgent.get(`/api/client/invoices/${invoice.id}`);
    expect(inv.body.invoice.status).toBe('confirmation_submitted');

    const row = get('SELECT status FROM payment_confirmations WHERE id = ?', [confirmation.id]);
    expect(row.status).toBe('submitted');
  });

  it('prevents duplicate submissions (idempotency key replay and unique constraint)', async () => {
    const inv = await freshInvoice();
    const ref = await createPaymentReference(clientAgent, inv.id, 'bank_transfer');
    const first = await submitConfirmation(clientAgent, ref.body.reference.id, { amountSent: '2500.00' }, 'key-dup-1');
    expect(first.status).toBe(201);

    // Same idempotency key → replay returns the original confirmation.
    const replay = await submitConfirmation(clientAgent, ref.body.reference.id, { amountSent: '2500.00' }, 'key-dup-1');
    expect(replay.status).toBe(200);
    expect(replay.body.idempotentReplay).toBe(true);
    expect(replay.body.confirmation.id).toBe(first.body.confirmation.id);

    // Same reference, different key → conflict, no duplicate row.
    const dup = await submitConfirmation(clientAgent, ref.body.reference.id, { amountSent: '2500.00' }, 'key-dup-2');
    expect(dup.status).toBe(409);

    const count = get('SELECT COUNT(*) AS n FROM payment_confirmations WHERE payment_reference_id = ?', [
      ref.body.reference.id,
    ]).n;
    expect(count).toBe(1);
  });

  it('validates the amount server-side (rejects invalid amounts)', async () => {
    const inv = await freshInvoice();
    const ref = await createPaymentReference(clientAgent, inv.id, 'bank_transfer');
    const res = await submitConfirmation(clientAgent, ref.body.reference.id, { amountSent: 'not-a-number' }, 'key-badamt');
    expect(res.status).toBe(400);
  });

  it('rejects partial payment when the invoice does not allow it', async () => {
    const inv = await freshInvoice();
    const ref = await createPaymentReference(clientAgent, inv.id, 'bank_transfer');
    const res = await submitConfirmation(clientAgent, ref.body.reference.id, { amountSent: '100.00' }, 'key-partial');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('full payment');
  });

  it('admin verification records the reviewer and timestamp, and marks the invoice paid', async () => {
    const inv = await freshInvoice();
    const ref = await createPaymentReference(clientAgent, inv.id, 'bank_transfer');
    const conf = await submitConfirmation(clientAgent, ref.body.reference.id, { amountSent: '2500.00' }, 'key-verify-1');
    const confirmationId = conf.body.confirmation.id;

    const review = await admin.post(`/api/admin/transactions/${confirmationId}/review`).send({ action: 'verified', note: 'Bank statement matches' });
    expect(review.status).toBe(200);

    const row = get(
      'SELECT pc.status, pc.reviewer_id, pc.reviewed_at, i.status AS invoice_status FROM payment_confirmations pc JOIN invoices i ON i.id = pc.invoice_id WHERE pc.id = ?',
      [confirmationId]
    );
    expect(row.status).toBe('verified');
    expect(row.reviewer_id).toBe(1);
    expect(row.reviewed_at).toBeTruthy();
    expect(row.invoice_status).toBe('paid');

    // Audit trail contains the verification.
    const audit = all("SELECT * FROM audit_logs WHERE action = 'payment_verified'");
    expect(audit.length).toBeGreaterThan(0);
  });

  it('rejection requires a reason and allows the client to resubmit', async () => {
    const inv2 = await createInvoice(admin, client.id, { description: 'Second invoice', amount: '500.00' });
    const ref = await createPaymentReference(clientAgent, inv2.id, 'bank_transfer');
    const conf = await submitConfirmation(clientAgent, ref.body.reference.id, { amountSent: '500.00' }, 'key-reject-1');
    const confirmationId = conf.body.confirmation.id;

    const noReason = await admin.post(`/api/admin/transactions/${confirmationId}/review`).send({ action: 'rejected' });
    expect(noReason.status).toBe(400);

    const rejected = await admin
      .post(`/api/admin/transactions/${confirmationId}/review`)
      .send({ action: 'rejected', reason: 'Receipt is illegible' });
    expect(rejected.status).toBe(200);

    const detail = await clientAgent.get(`/api/client/confirmations/${confirmationId}`);
    expect(detail.body.confirmation.status).toBe('rejected');
    expect(detail.body.confirmation.rejectionReason).toBe('Receipt is illegible');

    // The client can submit corrected information on the same reference.
    const resubmit = await submitConfirmation(clientAgent, ref.body.reference.id, {}, 'key-reject-2');
    expect(resubmit.status).toBe(201);
    expect(resubmit.body.confirmation.status).toBe('submitted');
  });

  it('marks a submission under review and requests information with a reason', async () => {
    const inv3 = await createInvoice(admin, client.id, { description: 'Third invoice', amount: '750.00' });
    const ref = await createPaymentReference(clientAgent, inv3.id, 'bank_transfer');
    const conf = await submitConfirmation(clientAgent, ref.body.reference.id, { amountSent: '750.00' }, 'key-info-1');
    const id = conf.body.confirmation.id;

    const underReview = await admin.post(`/api/admin/transactions/${id}/review`).send({ action: 'under_review' });
    expect(underReview.status).toBe(200);
    expect(get('SELECT status FROM payment_confirmations WHERE id = ?', [id]).status).toBe('under_review');

    const noReason = await admin.post(`/api/admin/transactions/${id}/review`).send({ action: 'info_requested' });
    expect(noReason.status).toBe(400);

    const info = await admin
      .post(`/api/admin/transactions/${id}/review`)
      .send({ action: 'info_requested', reason: 'Please provide the sender bank statement' });
    expect(info.status).toBe(200);
    expect(get('SELECT status FROM payment_confirmations WHERE id = ?', [id]).status).toBe('info_requested');
  });

  it('keeps historical instruction snapshots when configuration changes', async () => {
    const inv4 = await createInvoice(admin, client.id, { description: 'Fourth invoice', amount: '100.00' });
    const ref1 = await createPaymentReference(clientAgent, inv4.id, 'bank_transfer');
    const snapshotBefore = ref1.body.reference.instructionsSnapshot;

    // Admin changes the beneficiary details.
    await admin.put(`/api/admin/bank-instructions/${profile.id}`).send({
      currency: 'USD',
      profileName: 'Primary USD account',
      transferTypes: ['ach', 'domestic_wire', 'international_wire'],
      fields: {
        beneficiary_name: 'New Beneficiary Name Ltd',
        bank_name: 'First National Bank',
        account_number: '123456789012',
        routing_number: '021000021',
        swift_bic: 'FNBKUS33',
      },
    });

    // Historical reference keeps the old snapshot.
    const oldRef = await clientAgent.get(`/api/client/payment-references/${ref1.body.reference.id}`);
    expect(oldRef.body.reference.instructionsSnapshot.profile.fields.beneficiary_name).toBe(
      snapshotBefore.profile.fields.beneficiary_name
    );

    // A new reference gets the new instructions.
    const inv5 = await createInvoice(admin, client.id, { description: 'Fifth invoice', amount: '100.00' });
    const ref2 = await createPaymentReference(clientAgent, inv5.id, 'bank_transfer');
    expect(ref2.body.reference.instructionsSnapshot.profile.fields.beneficiary_name).toBe('New Beneficiary Name Ltd');
  });

  it('supports the Western Union flow end-to-end', async () => {
    // Configure Western Union for EUR.
    const wu = await admin.put('/api/admin/western-union').send({
      displayName: 'Western Union',
      currencies: ['EUR'],
      countries: ['Nigeria', 'Ghana'],
      recipientName: 'Agency EUR Recipient',
      countryOfReceipt: 'Nigeria',
      instructions: 'Send via Western Union agent',
      clientInstructions: 'Bring your ID and the MTCN',
      requiredSenderInfo: ['sender_full_name'],
      requiredRecipientInfo: ['recipient_full_name'],
      mtcnRequired: true,
      receiptRequired: true,
      enabled: true,
    });
    expect(wu.status).toBe(200);

    const eurInvoice = await createInvoice(admin, client.id, {
      description: 'EUR invoice',
      amount: '900.00',
      currency: 'EUR',
    });

    // EUR bank transfer is unavailable (no EUR profile), WU is available.
    const methods = await clientAgent.get(`/api/client/payment-methods?invoiceId=${eurInvoice.id}`);
    const wuMethod = methods.body.methods.find((m: any) => m.code === 'western_union');
    expect(wuMethod.available).toBe(true);
    const bankMethod = methods.body.methods.find((m: any) => m.code === 'bank_transfer');
    expect(bankMethod.available).toBe(false);

    // Issue a WU reference.
    const ref = await clientAgent
      .post('/api/client/payment-references')
      .send({ invoiceId: eurInvoice.id, method: 'western_union', currency: 'EUR' });
    expect(ref.status).toBe(201);
    expect(ref.body.reference.instructionsSnapshot.type).toBe('western_union');
    expect(ref.body.reference.instructionsSnapshot.recipientName).toBe('Agency EUR Recipient');

    // Confirmation requires the MTCN when mtcnRequired is set.
    const noMtcn = await clientAgent
      .post('/api/client/confirmations')
      .field('paymentReferenceId', String(ref.body.reference.id))
      .field('sentDate', '2026-10-09')
      .field('amountSent', '900.00')
      .field('currency', 'EUR')
      .field('method', 'western_union')
      .field('senderName', 'Test Client')
      .attach('receipt', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'wu-receipt.png');
    expect(noMtcn.status).toBe(400);
    expect(noMtcn.body.error.message).toContain('MTCN');

    // With the MTCN it succeeds and stays unverified.
    const conf = await clientAgent
      .post('/api/client/confirmations')
      .field('paymentReferenceId', String(ref.body.reference.id))
      .field('sentDate', '2026-10-09')
      .field('amountSent', '900.00')
      .field('currency', 'EUR')
      .field('method', 'western_union')
      .field('senderName', 'Test Client')
      .field('transferReference', 'MTCN-1234567890')
      .attach('receipt', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'wu-receipt.png');
    expect(conf.status).toBe(201);
    expect(conf.body.confirmation.status).toBe('submitted');
  });

  it('disabling a payment method prevents new selections', async () => {
    const methods = await admin.get('/api/admin/payment-methods');
    const wuMethod = methods.body.methods.find((m: any) => m.code === 'western_union');
    expect(wuMethod.enabled).toBe(true);
    const toPayload = (ms: any[], wuEnabled: boolean) => ({
      methods: ms.map((m: any, i: number) => ({
        code: m.code,
        name: m.name,
        enabled: m.code === 'western_union' ? wuEnabled : !!m.enabled,
        sortOrder: m.sort_order ?? i,
      })),
    });
    const disable = await admin.put('/api/admin/payment-methods').send(toPayload(methods.body.methods, false));
    expect(disable.status).toBe(200);

    const eurInvoice = await createInvoice(admin, client.id, { description: 'EUR 2', amount: '50.00', currency: 'EUR' });
    const res = await clientAgent
      .post('/api/client/payment-references')
      .send({ invoiceId: eurInvoice.id, method: 'western_union', currency: 'EUR' });
    expect(res.status).toBe(400);

    // Re-enable for other tests.
    await admin.put('/api/admin/payment-methods').send(toPayload(methods.body.methods, true));
  });

  it('dashboard statistics reflect actual database records', async () => {
    const res = await admin.get('/api/admin/dashboard/stats');
    expect(res.status).toBe(200);
    expect(res.body.totals.clients).toBeGreaterThan(0);
    expect(res.body.totals.invoices).toBeGreaterThan(0);
    expect(res.body.totals.confirmations).toBeGreaterThan(0);
    expect(res.body.confirmationsByStatus.verified).toBeGreaterThan(0);
    expect(res.body.confirmationsByStatus.rejected).toBeGreaterThan(0);
    expect(res.body.outstandingByCurrency.length).toBeGreaterThan(0);
    expect(res.body.verifiedByCurrency.length).toBeGreaterThan(0);
  });

  it('exports a CSV report of transactions', async () => {
    const res = await admin.get('/api/admin/reports/transactions.csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('payment_ref');
    expect(res.text).toContain('PAY-');
  });
});
