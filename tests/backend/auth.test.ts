import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import {
  makeApp,
  loginAdmin,
  createClient,
  loginClient,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  config,
} from './helpers';

describe('authentication and authorization', () => {
  let app: any;

  beforeAll(async () => {
    app = await makeApp();
  });

  it('rejects admin login with a wrong password', async () => {
    const res = await request(app)
      .post('/api/admin/auth/login')
      .send({ email: ADMIN_EMAIL, password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('logs in the bootstrap administrator and requires a password change on first login', async () => {
    const res = await request(app)
      .post('/api/admin/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.admin.email).toBe(ADMIN_EMAIL);
    expect(res.body.admin.role).toBe('superadmin');
    expect(res.body.mustChangePassword).toBe(true);
  });

  it('blocks admin API access until the initial password is changed', async () => {
    const agent = request.agent(app);
    await agent.post('/api/admin/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const res = await agent.get('/api/admin/settings');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('must_change_password');
  });

  it('allows the password change with the current password and then unlocks the API', async () => {
    const agent = request.agent(app);
    await agent.post('/api/admin/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const change = await agent
      .post('/api/admin/auth/change-password')
      .send({ currentPassword: ADMIN_PASSWORD, newPassword: 'FirstChange123' });
    expect(change.status).toBe(200);
    const settings = await agent.get('/api/admin/settings');
    expect(settings.status).toBe(200);
    // Restore the original password so later tests in this file can log in.
    const restore = await agent
      .post('/api/admin/auth/change-password')
      .send({ currentPassword: 'FirstChange123', newPassword: ADMIN_PASSWORD });
    expect(restore.status).toBe(200);
  });

  it('rejects a weak new password', async () => {
    const agent = request.agent(app);
    await agent.post('/api/admin/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const change = await agent
      .post('/api/admin/auth/change-password')
      .send({ currentPassword: ADMIN_PASSWORD, newPassword: 'short' });
    expect(change.status).toBe(400);
  });

  it('rejects unauthenticated access to admin and client APIs', async () => {
    expect((await request(app).get('/api/admin/settings')).status).toBe(401);
    expect((await request(app).get('/api/admin/dashboard/stats')).status).toBe(401);
    expect((await request(app).get('/api/client/dashboard')).status).toBe(401);
    expect((await request(app).get('/api/client/invoices')).status).toBe(401);
  });

  it('logs in a client with full name + access code and rejects wrong codes', async () => {
    const { agent: admin } = await loginAdmin(app);
    const client = await createClient(admin, 'Auth Test Client');

    const bad = await request(app)
      .post('/api/client/auth/login')
      .send({ fullName: client.fullName, accessCode: 'WRONGCODE' });
    expect(bad.status).toBe(401);

    const good = await request(app)
      .post('/api/client/auth/login')
      .send({ fullName: client.fullName, accessCode: client.accessCode });
    expect(good.status).toBe(200);
    expect(good.body.client.clientCode).toBe(client.clientCode);

    // Full name alone is not enough.
    const noCode = await request(app).post('/api/client/auth/login').send({ fullName: client.fullName });
    expect(noCode.status).toBe(400);
  });

  it('does not reveal whether a client name exists (generic error)', async () => {
    const res = await request(app)
      .post('/api/client/auth/login')
      .send({ fullName: 'No Such Person', accessCode: 'WHATEVER1' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid full name or access code.');
  });

  it('prevents a suspended client from authenticating', async () => {
    const { agent: admin } = await loginAdmin(app);
    const client = await createClient(admin, 'Suspended Client');
    const suspend = await admin.put(`/api/admin/clients/${client.id}`).send({ status: 'suspended' });
    expect(suspend.status).toBe(200);

    const res = await request(app)
      .post('/api/client/auth/login')
      .send({ fullName: client.fullName, accessCode: client.accessCode });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('suspended');
  });

  it('revokes client sessions when the access code is reset', async () => {
    const { agent: admin } = await loginAdmin(app);
    const client = await createClient(admin, 'Reset Client');
    const clientAgent = await loginClient(app, client);

    // Session works before reset.
    expect((await clientAgent.get('/api/client/invoices')).status).toBe(200);

    const reset = await admin.post(`/api/admin/clients/${client.id}/access-code/reset`);
    expect(reset.status).toBe(200);
    expect(reset.body.accessCode).not.toBe(client.accessCode);

    // Old session is revoked.
    expect((await clientAgent.get('/api/client/invoices')).status).toBe(401);

    // Old code no longer works; new code does.
    const oldLogin = await request(app)
      .post('/api/client/auth/login')
      .send({ fullName: client.fullName, accessCode: client.accessCode });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app)
      .post('/api/client/auth/login')
      .send({ fullName: client.fullName, accessCode: reset.body.accessCode });
    expect(newLogin.status).toBe(200);
  });

  it('rate limits repeated failed admin logins', async () => {
    const original = config.rateLimit.authMax;
    config.rateLimit.authMax = 3;
    try {
      let lastStatus = 0;
      for (let i = 0; i < 4; i += 1) {
        const res = await request(app)
          .post('/api/admin/auth/login')
          .send({ email: 'ratelimit@example.com', password: 'nope-nope' });
        lastStatus = res.status;
      }
      expect(lastStatus).toBe(429);
      expect((await request(app).post('/api/admin/auth/login').send({ email: 'x@y.z', password: 'nope' })).body.error.code).toBe('rate_limited');
    } finally {
      config.rateLimit.authMax = original;
    }
  });

  it('enforces server-side authorization: clients cannot reach admin endpoints', async () => {
    const { agent: admin } = await loginAdmin(app);
    const client = await createClient(admin, 'Intrusion Client');
    const clientAgent = await loginClient(app, client);

    expect((await clientAgent.get('/api/admin/settings')).status).toBe(401);
    expect((await clientAgent.get('/api/admin/transactions')).status).toBe(401);
    expect((await clientAgent.post('/api/admin/clients')).status).toBe(401);
    expect((await clientAgent.get('/api/admin/dashboard/stats')).status).toBe(401);
  });

  it('supports secure logout', async () => {
    const { agent: admin } = await loginAdmin(app);
    expect((await admin.get('/api/admin/auth/me')).status).toBe(200);
    expect((await admin.post('/api/admin/auth/logout')).status).toBe(200);
    expect((await admin.get('/api/admin/auth/me')).status).toBe(401);
  });
});
