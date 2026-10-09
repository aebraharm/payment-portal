import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN_NEW_PASSWORD,
  BOOTSTRAP_EMAIL,
  BOOTSTRAP_PASSWORD,
  adminLogin,
  call,
  createTestEnv,
  tokenFromMessage,
  type TestEnv,
} from './helpers';
import { bootstrapAdmin } from '../../server/services/bootstrap';

describe('smoke: bootstrap, login and a first invoice', () => {
  let env: TestEnv;

  beforeAll(async () => {
    env = await createTestEnv();
  });

  afterAll(async () => {
    await env.cleanup();
  });

  it('bootstraps the admin once and is idempotent afterwards', async () => {
    expect(await bootstrapAdmin(env.deps)).toBe('created');
    expect(await bootstrapAdmin(env.deps)).toBe('exists');
  });

  it('signs in with the bootstrap password and requires a password change', async () => {
    const res = await call(env, '/api/admin/auth/login', { json: { email: BOOTSTRAP_EMAIL, password: BOOTSTRAP_PASSWORD } });
    expect(res.status).toBe(200);
    expect(res.body.mustChangePassword).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(BOOTSTRAP_PASSWORD);
  });

  it('blocks data routes until the password is changed', async () => {
    const session = await adminLogin(env);
    const res = await call(env, '/api/admin/clients', { session });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    const change = await call(env, '/api/admin/auth/change-password', {
      session,
      json: { currentPassword: BOOTSTRAP_PASSWORD, newPassword: ADMIN_NEW_PASSWORD },
    });
    expect(change.status).toBe(200);
  });

  it('creates a client, sends an activation link and activates', async () => {
    const session = await adminLogin(env, BOOTSTRAP_EMAIL, ADMIN_NEW_PASSWORD);
    const created = await call(env, '/api/admin/clients', {
      session,
      json: { fullName: 'Amina Yusuf', email: 'amina@example.test', phone: '' },
    });
    expect(created.status).toBe(201);
    const clientId = created.body.client.id as string;
    const invite = await call(env, `/api/admin/clients/${clientId}/invitation`, { session, json: {} });
    expect(invite.status).toBe(200);
    const token = tokenFromMessage(invite.body.activationUrl);
    const activated = await call(env, '/api/client/auth/activation/complete', {
      json: { token, accessCode: 'my-access-code-2026' },
    });
    expect(activated.status).toBe(200);
    const login = await call(env, '/api/client/auth/login', {
      json: { fullName: 'amina   yusuf', accessCode: 'my-access-code-2026' },
    });
    expect(login.status).toBe(200);
  });

  it('computes invoice totals on the server and returns derived status', async () => {
    const session = await adminLogin(env, BOOTSTRAP_EMAIL, ADMIN_NEW_PASSWORD);
    const clients = await call(env, '/api/admin/clients', { session });
    const clientId = clients.body.clients[0].id as string;
    const invoice = await call(env, '/api/admin/invoices', {
      session,
      json: {
        clientId,
        description: 'Visa processing',
        currency: 'USD',
        issueDate: '2026-10-09',
        dueDate: '2026-10-30',
        partialPaymentsAllowed: false,
        notes: '',
        lineItems: [
          { description: 'Service', kind: 'charge', amount: '1000.00' },
          { description: 'Filing fee', kind: 'fee', amount: '250.50' },
          { description: 'Loyalty', kind: 'discount', amount: '50.50' },
        ],
      },
    });
    expect(invoice.status).toBe(201);
    expect(invoice.body.invoice.totalAmount).toBe('1200.00');
    expect(invoice.body.invoice.statusLabel).toBe('Unpaid');
    expect(invoice.body.invoice.invoiceNumber).toMatch(/^INV-2026-\d{5}$/);
  });
});
