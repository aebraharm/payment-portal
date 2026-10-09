import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../server/app.js';
import { seedDatabase } from '../../server/seed.js';
import { get, all } from '../../server/db.js';
import { config } from '../../server/config.js';

export const ADMIN_EMAIL = 'test-bootstrap-admin@example.com';
export const ADMIN_PASSWORD = 'TestBootstrapPass123';

/** A minimal buffer with a valid PNG signature (magic bytes only). */
export const PNG_BUFFER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

let appInstance: Express | null = null;

/** Build the app once per test file and seed the database idempotently. */
export async function makeApp(): Promise<Express> {
  if (!appInstance) {
    await seedDatabase();
    appInstance = createApp();
  }
  return appInstance;
}

/** Log in as the bootstrap administrator (changing the password first if needed). */
export async function loginAdmin(app: Express) {
  const agent = request.agent(app);
  const login = await agent.post('/api/admin/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (login.status === 200 && login.body.mustChangePassword) {
    await agent
      .post('/api/admin/auth/change-password')
      .send({ currentPassword: ADMIN_PASSWORD, newPassword: 'TestAdminPass123' });
    const relogin = await agent.post('/api/admin/auth/login').send({ email: ADMIN_EMAIL, password: 'TestAdminPass123' });
    return { agent, password: 'TestAdminPass123', login: relogin };
  }
  return { agent, password: ADMIN_PASSWORD, login };
}

export interface TestClient {
  id: number;
  clientCode: string;
  fullName: string;
  accessCode: string;
}

/** Create a client as admin and return its one-time access code. */
export async function createClient(
  adminAgent: request.SuperAgentTest,
  fullName: string,
  email = `${fullName.replace(/\s+/g, '.').toLowerCase()}@example.com`
): Promise<TestClient> {
  const res = await adminAgent.post('/api/admin/clients').send({ fullName, email });
  if (res.status !== 201) throw new Error(`createClient failed: ${res.status} ${JSON.stringify(res.body)}`);
  return {
    id: res.body.client.id,
    clientCode: res.body.client.clientCode,
    fullName: res.body.client.fullName,
    accessCode: res.body.accessCode,
  };
}

/** Log in as a client. */
export async function loginClient(app: Express, client: TestClient) {
  const agent = request.agent(app);
  const res = await agent.post('/api/client/auth/login').send({ fullName: client.fullName, accessCode: client.accessCode });
  if (res.status !== 200) throw new Error(`loginClient failed: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

/** Create an invoice for a client. */
export async function createInvoice(
  adminAgent: request.SuperAgentTest,
  clientId: number,
  overrides: Record<string, unknown> = {}
) {
  const res = await adminAgent.post('/api/admin/invoices').send({
    clientId,
    description: 'Visa application processing',
    amount: '1500.00',
    currency: 'USD',
    issueDate: '2026-10-01',
    dueDate: '2026-10-31',
    ...overrides,
  });
  if (res.status !== 201) throw new Error(`createInvoice failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.invoice;
}

/** Create a USD bank instruction profile. */
export async function createUsdProfile(adminAgent: request.SuperAgentTest, fields: Record<string, string> = {}) {
  const res = await adminAgent.post('/api/admin/bank-instructions').send({
    currency: 'USD',
    profileName: 'Primary USD account',
    transferTypes: ['ach', 'domestic_wire', 'international_wire'],
    fields: {
      beneficiary_name: 'Global Visa Consultants Ltd',
      bank_name: 'First National Bank',
      account_number: '123456789012',
      routing_number: '021000021',
      swift_bic: 'FNBKUS33',
      ...fields,
    },
  });
  if (res.status !== 201) throw new Error(`createUsdProfile failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.profile;
}

/** Issue a payment reference for an invoice via the client API. */
export async function createPaymentReference(
  clientAgent: request.SuperAgentTest,
  invoiceId: number,
  method = 'bank_transfer'
) {
  const res = await clientAgent.post('/api/client/payment-references').send({ invoiceId, method, currency: 'USD' });
  return res;
}

/** Submit a payment confirmation with a valid PNG receipt. */
export async function submitConfirmation(
  clientAgent: request.SuperAgentTest,
  referenceId: number,
  overrides: Record<string, unknown> = {},
  idempotencyKey?: string
) {
  // Overrides win over defaults — fields are sent exactly once (no duplicates).
  const fields: Record<string, string> = {
    paymentReferenceId: String(referenceId),
    sentDate: '2026-10-09',
    amountSent: '1500.00',
    currency: 'USD',
    method: 'bank_transfer',
    senderName: 'Test Client',
    transferReference: 'ACH-REF-12345',
    ...(overrides as Record<string, string>),
  };
  let req = clientAgent.post('/api/client/confirmations');
  for (const [k, v] of Object.entries(fields)) {
    req = req.field(k, v);
  }
  req = req.attach('receipt', PNG_BUFFER, 'receipt.png');
  if (idempotencyKey) req = req.set('Idempotency-Key', idempotencyKey);
  return req;
}

export { get, all, config };
