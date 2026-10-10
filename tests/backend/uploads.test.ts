import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import {
  makeApp,
  loginAdmin,
  createClient,
  loginClient,
  createInvoice,
  createUsdProfile,
  createPaymentReference,
  submitConfirmation,
  PNG_BUFFER,
  get,
  config,
} from './helpers';

describe('receipt uploads and file security', () => {
  let app: any;
  let admin: request.SuperAgentTest;
  let client: any;
  let clientAgent: request.SuperAgentTest;
  let invoice: any;
  let confirmationId: number;
  let receiptId: number;

  beforeAll(async () => {
    app = await makeApp();
    ({ agent: admin } = await loginAdmin(app));
    client = await createClient(admin, 'Receipt Client', 'receipt@example.com');
    clientAgent = await loginClient(app, client);
    invoice = await createInvoice(admin, client.id, { amount: '1000.00' });
    await createUsdProfile(admin);
    const ref = await createPaymentReference(clientAgent, invoice.id, 'bank_transfer');
    const conf = await submitConfirmation(clientAgent, ref.body.reference.id, { amountSent: '1000.00' }, 'key-upload-1');
    expect(conf.status).toBe(201);
    confirmationId = conf.body.confirmation.id;
    // The submission response does not embed receipts; fetch the detail.
    const detail = await clientAgent.get(`/api/client/confirmations/${confirmationId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.receipts.length).toBe(1);
    receiptId = detail.body.receipts[0].id;
  });

  it('rejects unsupported file types (extension)', async () => {
    const res = await clientAgent
      .post(`/api/client/confirmations/${confirmationId}/receipts`)
      .attach('receipt', Buffer.from('MZ'), 'malware.exe');
    expect(res.status).toBe(400);
  });

  it('rejects unsupported file types (content)', async () => {
    // A text file renamed to .png must fail magic-byte validation.
    const res = await clientAgent
      .post(`/api/client/confirmations/${confirmationId}/receipts`)
      .attach('receipt', Buffer.from('this is definitely not a png'), 'fake.png');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('does not match');
  });

  it('rejects a missing receipt file', async () => {
    const res = await clientAgent.post(`/api/client/confirmations/${confirmationId}/receipts`);
    expect(res.status).toBe(400);
  });

  it('accepts a valid PDF receipt', async () => {
    const pdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]); // %PDF-1.7
    const res = await clientAgent
      .post(`/api/client/confirmations/${confirmationId}/receipts`)
      .attach('receipt', pdf, 'bank-slip.pdf');
    expect(res.status).toBe(201);
    // The newly uploaded PDF is the most recent receipt on this confirmation.
    const uploaded = res.body.receipts[res.body.receipts.length - 1];
    expect(uploaded.mimeType).toBe('application/pdf');
    expect(uploaded.originalFilename).toBe('bank-slip.pdf');
  });

  it('stores files outside the web root under a private directory', async () => {
    const row = await get('SELECT stored_filename, mime_type FROM receipts WHERE id = ?', [receiptId]);
    expect(row.stored_filename).toMatch(/^receipts\/\d{4}\/\d{2}\//);
    const absolute = path.join(config.uploadDir, row.stored_filename);
    expect(fs.existsSync(absolute)).toBe(true);
    // The stored name must never equal the original client filename.
    expect(row.stored_filename).not.toContain('receipt.png');
  });

  it('serves receipts only to the owner or an admin', async () => {
    const owner = await clientAgent.get(`/api/files/receipts/${receiptId}`);
    expect(owner.status).toBe(200);
    expect(owner.headers['content-type']).toBe('image/png');
    expect(owner.headers['x-content-type-options']).toBe('nosniff');
    expect(owner.body.equals(PNG_BUFFER)).toBe(true);

    const asAdmin = await admin.get(`/api/files/receipts/${receiptId}`);
    expect(asAdmin.status).toBe(200);

    const stranger = await createClient(admin, 'Stranger Client', 'stranger@example.com');
    const strangerAgent = await loginClient(app, stranger);
    const denied = await strangerAgent.get(`/api/files/receipts/${receiptId}`);
    expect(denied.status).toBe(403);

    const anon = await request(app).get(`/api/files/receipts/${receiptId}`);
    expect(anon.status).toBe(401);
  });

  it('returns 404 for unknown receipt ids', async () => {
    expect((await clientAgent.get('/api/files/receipts/99999')).status).toBe(404);
  });

  it('rejects path traversal attempts on receipt ids', async () => {
    const res = await clientAgent.get('/api/files/receipts/..%2F..%2Fpackage.json');
    expect([400, 404]).toContain(res.status);
  });

  it('limits the number of receipts per confirmation to protect storage', async () => {
    // A fresh invoice: the shared one already has a confirmation submitted.
    const inv2 = await createInvoice(admin, client.id, { description: 'Receipt limit invoice', amount: '1000.00' });
    const ref = await createPaymentReference(clientAgent, inv2.id, 'bank_transfer');
    const conf = await submitConfirmation(clientAgent, ref.body.reference.id, { amountSent: '1000.00' }, 'key-upload-many');
    expect(conf.status).toBe(201);
    const id = conf.body.confirmation.id;
    // The submission already carries one receipt; nine more are allowed.
    for (let i = 0; i < 9; i += 1) {
      const res = await clientAgent
        .post(`/api/client/confirmations/${id}/receipts`)
        .attach('receipt', PNG_BUFFER, `extra-${i}.png`);
      expect(res.status).toBe(201);
      expect(res.body.receipts[res.body.receipts.length - 1].mimeType).toBe('image/png');
    }
    // The eleventh receipt is rejected.
    const overflow = await clientAgent
      .post(`/api/client/confirmations/${id}/receipts`)
      .attach('receipt', PNG_BUFFER, 'one-too-many.png');
    expect(overflow.status).toBe(400);
    expect(overflow.body.error.message).toContain('at most 10');
  });
});
