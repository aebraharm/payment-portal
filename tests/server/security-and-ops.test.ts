import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashSecret } from '../../server/security/passwords';
import { bootstrapAdmin } from '../../server/services/bootstrap';
import { sweepReminders } from '../../server/services/notifications';
import { csvCell } from '../../server/services/reports';
import { abaChecksumValid, ibanChecksumValid, validateBankFields } from '../../shared/bank';
import { daysBetween } from '../../shared/dates';
import { compareAmounts, subtractAmounts, sumAmounts } from '../../shared/money';
import { unknownPlaceholders } from '../../shared/settings';
import {
  ADMIN_NEW_PASSWORD,
  BOOTSTRAP_EMAIL,
  BOOTSTRAP_PASSWORD,
  CLIENT_CODE,
  CLIENT_NAME,
  adminLogin,
  call,
  clientCall,
  clientLogin,
  createTestEnv,
  seedPortal,
  type TestEnv,
} from './helpers';

describe('bootstrap administrator', () => {
  let env: TestEnv;

  beforeAll(async () => {
    env = await createTestEnv();
  });
  afterAll(async () => {
    await env.cleanup();
  });

  it('creates the account once, stores only a hash, and requires a password change', async () => {
    expect(await bootstrapAdmin(env.deps)).toBe('created');
    expect(await bootstrapAdmin(env.deps)).toBe('exists');
    const row = await env.deps.db.query<{ password_hash: string; must_change_password: boolean; email: string }>(
      'SELECT password_hash, must_change_password, email FROM admin_users WHERE email = $1',
      [BOOTSTRAP_EMAIL],
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].must_change_password).toBe(true);
    expect(row.rows[0].password_hash).not.toContain(BOOTSTRAP_PASSWORD);
    expect(row.rows[0].password_hash.startsWith('scrypt')).toBe(true);
  });

  it('gives the same generic error for an unknown email and a wrong password', async () => {
    const unknown = await call(env, '/api/admin/auth/login', { json: { email: 'nobody@example.test', password: 'whatever-password-1' } });
    const wrong = await call(env, '/api/admin/auth/login', { json: { email: BOOTSTRAP_EMAIL, password: 'definitely-wrong-1' } });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
  });

  it('enforces the admin password minimum on change', async () => {
    const session = await adminLogin(env);
    const short = await call(env, '/api/admin/auth/change-password', { session, json: { currentPassword: BOOTSTRAP_PASSWORD, newPassword: 'short' } });
    expect(short.status).toBe(422);
  });
});

describe('request protection', () => {
  let env: TestEnv;
  let seed: Awaited<ReturnType<typeof seedPortal>>;

  beforeAll(async () => {
    env = await createTestEnv();
    seed = await seedPortal(env);
  });
  afterAll(async () => {
    await env.cleanup();
  });

  it('rejects state-changing requests without the CSRF token', async () => {
    const res = await call(env, '/api/admin/clients', { session: { cookie: seed.admin.cookie, csrf: 'wrong-token' }, json: { fullName: 'Test Person', email: 'x@example.test', phone: '' } });
    expect(res.status).toBe(403);
  });

  it('rejects cross-site requests by origin', async () => {
    const res = await call(env, '/api/admin/clients', { session: seed.admin, origin: 'https://evil.example', json: { fullName: 'Test Person', email: 'y@example.test', phone: '' } });
    expect(res.status).toBe(403);
  });

  it('serves the public configuration from the database without secrets', async () => {
    const res = await call(env, '/api/public/config');
    expect(res.status).toBe(200);
    expect(res.body.branding).toBeDefined();
    expect(res.body.payments.card.enabled).toBe(false);
    expect(res.body.payments.card.label).toBe('Not available in your region');
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(BOOTSTRAP_PASSWORD);
    expect(text).not.toContain('test-secret-that-is-long-enough');
    expect(text).not.toContain('routing_number');
  });

  it('publishes settings only when they are published, not when drafted', async () => {
    await call(env, '/api/admin/settings/branding', { session: seed.admin, method: 'PUT', json: { ...(await currentBranding(env, seed.admin)), agencyName: 'Draft Name Only' } });
    const before = await call(env, '/api/public/config');
    expect(before.body.branding.agencyName).not.toBe('Draft Name Only');
    await call(env, '/api/admin/settings/branding/publish', { session: seed.admin, json: {} });
    const after = await call(env, '/api/public/config');
    expect(after.body.branding.agencyName).toBe('Draft Name Only');
  });

  it('refuses notification templates that use unknown placeholders', async () => {
    expect(unknownPlaceholders('Hello {{clientName}}, see {{notAField}}')).toEqual(['notAField']);
    const settings = await call(env, '/api/admin/settings', { session: seed.admin });
    const draft = settings.body.settings.notifications.draft as Record<string, { enabled: boolean; subject: string; body: string }>;
    const key = Object.keys(draft)[0];
    const bad = { ...draft, [key]: { ...draft[key], body: 'Pay {{unknownThing}} now' } };
    const res = await call(env, '/api/admin/settings/notifications', { session: seed.admin, method: 'PUT', json: bad });
    expect(res.status).toBe(422);
  });

  it('keeps settings away from viewers, for reading as well as writing', async () => {
    const hash = await hashSecret('viewer-passphrase-2026');
    await env.deps.db.query(
      `INSERT INTO admin_users (id, email, display_name, role, status, password_hash, must_change_password, created_at, updated_at)
       VALUES ($1, 'viewer2@example.test', 'Viewer Two', 'viewer', 'active', $2, false, now(), now())`,
      [crypto.randomUUID(), hash],
    );
    const viewer = await adminLogin(env, 'viewer2@example.test', 'viewer-passphrase-2026');
    // Viewers do not hold settings:read, so the settings area is hidden from them in the navigation too.
    const read = await call(env, '/api/admin/settings', { session: viewer });
    expect(read.status).toBe(403);
    const write = await call(env, '/api/admin/settings/branding', { session: viewer, method: 'PUT', json: { agencyName: 'Hijack' } });
    expect(write.status).toBe(403);
    const payment = await call(env, '/api/admin/payment-config/currencies/GBP', { session: viewer, method: 'PUT', json: { enabled: true } });
    expect(payment.status).toBe(403);
  });

  it('exports CSV with spreadsheet formula injection neutralised', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toMatch(/^"?'=/);
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
  });

  it('keeps client login rate-limited per name and per network', async () => {
    const limited = await createTestEnv({ config: { rateLimits: { windowMs: 15 * 60_000, adminLoginPerEmail: 1000, adminLoginPerIp: 1000, clientLoginPerName: 3, clientLoginPerIp: 1000, resetRequestsPerEmail: 1000 } } });
    try {
      const limitedSeed = await seedPortal(limited);
      void limitedSeed;
      let last = { status: 0, body: null as null | { error: { code: string; retryAfterSeconds?: number } } };
      for (let i = 0; i < 4; i += 1) {
        last = await call(limited, '/api/client/auth/login', { json: { fullName: CLIENT_NAME, accessCode: 'wrong-code-value' } });
      }
      expect(last.status).toBe(429);
      expect(last.body?.error.code).toBe('RATE_LIMITED');
    } finally {
      await limited.cleanup();
    }
  }, 60_000);

  it('still accepts the correct access code for a client with the right name', async () => {
    const res = await call(env, '/api/client/auth/login', { json: { fullName: CLIENT_NAME, accessCode: CLIENT_CODE } });
    expect(res.status).toBe(200);
    const session = await clientCall(env, '/api/client/dashboard', { cookie: 'x', csrf: 'x' });
    expect(session.status).toBe(401);
  });
});

describe('notifications and reminders', () => {
  let env: TestEnv;

  beforeAll(async () => {
    env = await createTestEnv({ mailerConfigured: false });
  });
  afterAll(async () => {
    await env.cleanup();
  });

  it('never reports an email as sent when mail is not configured', async () => {
    const seed = await seedPortal(env);
    const rows = await env.deps.db.query<{ status: string }>('SELECT status FROM notifications');
    expect(rows.rows.length).toBeGreaterThan(0);
    expect(rows.rows.every((row) => row.status !== 'sent')).toBe(true);
    expect(rows.rows.some((row) => row.status === 'not_configured')).toBe(true);
    const sentInvite = await call(env, `/api/admin/clients/${seed.clientId}/access-reset`, { session: seed.admin, json: {} });
    expect(sentInvite.body.notification).toBe('not_configured');
  });

  it('sends each due-soon and overdue reminder once, using dedupe keys', async () => {
    const withMail = await createTestEnv({ mailerConfigured: true });
    try {
      await seedPortal(withMail);
      // Invoice is due on 2026-10-30; the test clock is 2026-10-09. Move the clock so it is 3 days away.
      withMail.setNow('2026-10-27T08:00:00Z');
      await call(withMail, '/api/admin/settings/operations', { session: await adminLogin(withMail, BOOTSTRAP_EMAIL, ADMIN_NEW_PASSWORD), method: 'PUT', json: { ...(await currentOps(withMail)), reminderDaysBefore: [3], overdueReminderEveryDays: 7 } });
      await call(withMail, '/api/admin/settings/operations/publish', { session: await adminLogin(withMail, BOOTSTRAP_EMAIL, ADMIN_NEW_PASSWORD), json: {} });
      const first = await sweepReminders(withMail.deps);
      const second = await sweepReminders(withMail.deps);
      expect(first.dueSoon).toBe(1);
      expect(second.dueSoon).toBe(0);
      // Due on 2026-10-30, so seven days overdue is 2026-11-06.
      withMail.setNow('2026-11-06T08:00:00Z');
      const overdue = await sweepReminders(withMail.deps);
      expect(overdue.overdue).toBeGreaterThanOrEqual(1);
    } finally {
      await withMail.cleanup();
    }
  }, 60_000);
});

async function currentBranding(env: TestEnv, session: Awaited<ReturnType<typeof adminLogin>>) {
  const res = await call(env, '/api/admin/settings', { session });
  return res.body.settings.branding.draft;
}

async function currentOps(env: TestEnv) {
  const session = await adminLogin(env, BOOTSTRAP_EMAIL, ADMIN_NEW_PASSWORD);
  const res = await call(env, '/api/admin/settings', { session });
  return res.body.settings.operations.draft;
}

describe('shared rules used by both sides', () => {
  it('computes whole-day differences as to minus from', () => {
    expect(daysBetween('2026-10-09', '2026-10-30')).toBe(21);
    expect(daysBetween('2026-10-30', '2026-10-09')).toBe(-21);
  });

  it('does exact decimal arithmetic on money strings', () => {
    expect(sumAmounts(['0.10', '0.20'])).toBe('0.30');
    expect(subtractAmounts('10.00', '0.01')).toBe('9.99');
    expect(compareAmounts('1000.00', '999.99')).toBe(1);
  });

  it('validates real bank formats without rejecting legitimate ones', () => {
    expect(abaChecksumValid('021000021')).toBe(true);
    expect(abaChecksumValid('021000022')).toBe(false);
    expect(ibanChecksumValid('GB82 WEST 1234 5698 7654 32')).toBe(true);
    const ok = validateBankFields('USD', 'ach', { routing_number: '021000021', account_number: '123456789', beneficiary_name: 'Agency Ltd', bank_name: 'Test Bank', account_type: 'checking' });
    expect(ok.valid).toBe(true);
    const badRouting = validateBankFields('USD', 'ach', { routing_number: '021000022', account_number: '123456789', beneficiary_name: 'Agency Ltd', bank_name: 'Test Bank', account_type: 'checking' });
    expect(badRouting.valid).toBe(false);
    expect(Object.keys(badRouting.errors)).toContain('routing_number');
  });
});

describe('client data isolation', () => {
  let env: TestEnv;
  let seed: Awaited<ReturnType<typeof seedPortal>>;

  beforeAll(async () => {
    env = await createTestEnv();
    seed = await seedPortal(env);
  });
  afterAll(async () => {
    await env.cleanup();
  });

  it('shows a client only their own invoices and references', async () => {
    const other = await call(env, '/api/admin/clients', { session: seed.admin, json: { fullName: 'Ngozi Eze', email: 'ngozi@example.test', phone: '' } });
    const invite = await call(env, `/api/admin/clients/${other.body.client.id}/invitation`, { session: seed.admin, json: {} });
    const token = /#token=([A-Za-z0-9_-]+)/.exec(invite.body.activationUrl)![1];
    await call(env, '/api/client/auth/activation/complete', { json: { token, accessCode: 'ngozi-access-2026' } });
    const otherSession = await clientLogin(env, 'Ngozi Eze', 'ngozi-access-2026');

    const foreignInvoice = await clientCall(env, `/api/client/invoices/${seed.invoiceId}`, otherSession);
    expect(foreignInvoice.status).toBe(404);
    const foreignDashboard = await clientCall(env, '/api/client/dashboard', otherSession);
    expect(foreignDashboard.status).toBe(200);
    expect(foreignDashboard.body.invoices).toHaveLength(0);
    const mine = await clientCall(env, '/api/client/dashboard', seed.client);
    expect(mine.body.invoices.map((i: { id: string }) => i.id)).toContain(seed.invoiceId);
  });
});
