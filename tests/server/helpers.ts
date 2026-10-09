/* eslint-disable @typescript-eslint/no-explicit-any -- test helper: response bodies are untyped JSON */
// Test harness: a real application instance backed by an in-memory PostgreSQL-compatible database,
// a temporary private receipt directory and an in-memory mailer. Requests go through the same Hono app
// that production uses. The clock is controllable so expiry and reminder rules can be tested.

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../../server/http/app';
import { createDeps } from '../../server/runtime';
import { createMemoryMailer, type Mailer } from '../../server/email/mailer';
import { createLocalReceiptStorage } from '../../server/storage/local';
import { setPasswordHashCost } from '../../server/security/passwords';
import type { Deps } from '../../server/deps';
import type { AppEnv } from '../../server/http/context';
import type { Hono } from 'hono';

export const APP_URL = 'http://localhost:5173';
export const BOOTSTRAP_EMAIL = 'portal11@gmail.com';
// Generated per run so no password-like value is ever stored in the repository.
export const BOOTSTRAP_PASSWORD = `bootstrap-${crypto.randomUUID()}`;
export const ADMIN_NEW_PASSWORD = `rotated-${crypto.randomUUID()}-passphrase`;

export interface TestEnv {
  app: Hono<AppEnv>;
  deps: Deps;
  mailer: ReturnType<typeof createMemoryMailer>;
  clock: { now: Date };
  receiptDir: string;
  cleanup: () => Promise<void>;
  setNow: (iso: string) => void;
}

export async function createTestEnv(options: {
  mailerConfigured?: boolean;
  env?: Record<string, string>;
  config?: Partial<Deps['config']>;
} = {}): Promise<TestEnv> {
  setPasswordHashCost({ N: 1024, r: 8, p: 1 });
  const clock = { now: new Date('2026-10-09T10:00:00Z') };
  const receiptDir = await mkdtemp(path.join(os.tmpdir(), 'pp-receipts-'));
  const mailer = createMemoryMailer({ configured: options.mailerConfigured ?? true });
  const deps = await createDeps({
    env: {
      NODE_ENV: 'test',
      APP_URL,
      APP_SECRET: 'test-secret-that-is-long-enough-for-hmac-00000000',
      ADMIN_BOOTSTRAP_EMAIL: BOOTSTRAP_EMAIL,
      ADMIN_BOOTSTRAP_PASSWORD: BOOTSTRAP_PASSWORD,
      ...options.env,
    },
    inMemoryDatabase: true,
    mailer: mailer as Mailer,
    storage: createLocalReceiptStorage(receiptDir),
    now: () => new Date(clock.now),
    config: {
      rateLimits: {
        windowMs: 15 * 60_000,
        adminLoginPerEmail: 1000,
        adminLoginPerIp: 1000,
        clientLoginPerName: 1000,
        clientLoginPerIp: 1000,
        resetRequestsPerEmail: 1000,
      },
      ...options.config,
    },
  });
  const app = createApp(deps);
  return {
    app,
    deps,
    mailer,
    clock,
    receiptDir,
    setNow(iso: string) {
      clock.now = new Date(iso);
    },
    async cleanup() {
      await deps.db.close();
      await rm(receiptDir, { recursive: true, force: true });
    },
  };
}

export interface Session {
  cookie: string;
  csrf: string;
}

export interface CallOptions {
  method?: string;
  json?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
  session?: Session | null;
  cookieName?: 'pp_admin_session' | 'pp_client_session';
  origin?: string | null;
}

export interface CallResult {
  status: number;
  body: any;
  headers: Headers;
  setCookies: string[];
}

export async function call(env: TestEnv, pathname: string, options: CallOptions = {}): Promise<CallResult> {
  const headers: Record<string, string> = {
    host: 'localhost:5173',
    ...(options.origin === null ? {} : { origin: options.origin ?? APP_URL }),
    ...(options.headers ?? {}),
  };
  if (options.session) {
    headers.cookie = `${options.cookieName ?? 'pp_admin_session'}=${options.session.cookie}`;
    headers['x-csrf-token'] = options.session.csrf;
  }
  let body: RequestInit['body'] | undefined;
  if (options.form) {
    body = options.form;
  } else if (options.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.json);
  }
  const response = await env.app.request(`http://localhost:5173${pathname}`, {
    method: options.method ?? (body ? 'POST' : 'GET'),
    headers,
    body,
  });
  const text = await response.text();
  let parsed: any = null;
  const type = response.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    parsed = text ? JSON.parse(text) : null;
  } else {
    parsed = text;
  }
  return { status: response.status, body: parsed, headers: response.headers, setCookies: response.headers.getSetCookie() };
}

export function cookieFrom(setCookies: string[], name: string): string | null {
  for (const line of setCookies) {
    const match = new RegExp(`^${name}=([^;]+)`).exec(line);
    if (match) return match[1];
  }
  return null;
}

export async function adminLogin(env: TestEnv, email = BOOTSTRAP_EMAIL, password = BOOTSTRAP_PASSWORD): Promise<Session> {
  const res = await call(env, '/api/admin/auth/login', { json: { email, password } });
  if (res.status !== 200) throw new Error(`admin login failed: ${res.status} ${JSON.stringify(res.body)}`);
  const cookie = cookieFrom(res.setCookies, 'pp_admin_session');
  if (!cookie) throw new Error('no admin cookie');
  return { cookie, csrf: res.body.csrfToken as string };
}

export async function clientLogin(env: TestEnv, fullName: string, accessCode: string): Promise<Session> {
  const res = await call(env, '/api/client/auth/login', { json: { fullName, accessCode } });
  if (res.status !== 200) throw new Error(`client login failed: ${res.status} ${JSON.stringify(res.body)}`);
  const cookie = cookieFrom(res.setCookies, 'pp_client_session');
  if (!cookie) throw new Error('no client cookie');
  return { cookie, csrf: res.body.csrfToken as string };
}

/** Pulls the single-use link token out of a sent message, for example the activation or reset link. */
export function tokenFromMessage(text: string): string {
  const match = /#token=([A-Za-z0-9_-]+)/.exec(text);
  if (!match) throw new Error('no token found in message');
  return match[1];
}

export function uuid(): string {
  return crypto.randomUUID();
}

export const CLIENT_CODE = 'my-access-code-2026';
export const CLIENT_NAME = 'Amina Yusuf';

export const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0x25, 0x45, 0x4f, 0x46, 0x0a]);
export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
export const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);

/** A complete, realistic portal: bootstrapped admin, activated client, USD bank account, one open invoice. */
export async function seedPortal(env: TestEnv, options: { partialPaymentsAllowed?: boolean; amount?: string } = {}) {
  const { bootstrapAdmin } = await import('../../server/services/bootstrap');
  await bootstrapAdmin(env.deps);
  const first = await adminLogin(env);
  await call(env, '/api/admin/auth/change-password', { session: first, json: { currentPassword: BOOTSTRAP_PASSWORD, newPassword: ADMIN_NEW_PASSWORD } });
  const admin = await adminLogin(env, BOOTSTRAP_EMAIL, ADMIN_NEW_PASSWORD);
  const created = await call(env, '/api/admin/clients', { session: admin, json: { fullName: CLIENT_NAME, email: 'amina@example.test', phone: '' } });
  const clientId = created.body.client.id as string;
  const invite = await call(env, `/api/admin/clients/${clientId}/invitation`, { session: admin, json: {} });
  const token = tokenFromMessage(invite.body.activationUrl);
  const activated = await call(env, '/api/client/auth/activation/complete', { json: { token, accessCode: CLIENT_CODE } });
  if (activated.status !== 200) throw new Error(`activation failed: ${JSON.stringify(activated.body)}`);
  await call(env, '/api/admin/payment-config/currencies/USD', { session: admin, method: 'PUT', json: { enabled: true } });
  const bank = await call(env, '/api/admin/payment-config/bank-profiles', {
    session: admin,
    json: {
      currency: 'USD',
      transferType: 'ach',
      label: 'Main USD account',
      enabled: true,
      sortOrder: 1,
      fields: { routing_number: '021000021', account_number: '123456789', beneficiary_name: 'Agency Ltd', bank_name: 'Test Bank', account_type: 'checking' },
    },
  });
  if (bank.status !== 201) throw new Error(`bank profile failed: ${JSON.stringify(bank.body)}`);
  await call(env, '/api/admin/payment-config/methods/bank_transfer', { session: admin, method: 'PUT', json: { enabled: true } });
  const invoice = await call(env, '/api/admin/invoices', {
    session: admin,
    json: {
      clientId,
      description: 'Visa processing',
      currency: 'USD',
      issueDate: '2026-10-09',
      dueDate: '2026-10-30',
      partialPaymentsAllowed: options.partialPaymentsAllowed ?? false,
      notes: '',
      lineItems: [{ description: 'Service', kind: 'charge', amount: options.amount ?? '1000.00' }],
    },
  });
  if (invoice.status !== 201) throw new Error(`invoice failed: ${JSON.stringify(invoice.body)}`);
  const client = await clientLogin(env, CLIENT_NAME, CLIENT_CODE);
  return {
    admin,
    client,
    clientId,
    invoiceId: invoice.body.invoice.id as string,
    bankProfileId: bank.body.profile.id as string,
  };
}

export const clientCall = (env: TestEnv, path: string, session: Session, options: CallOptions = {}) =>
  call(env, path, { ...options, session, cookieName: 'pp_client_session' });

export function confirmationForm(overrides: Record<string, string> = {}, receipt?: { bytes: Uint8Array; type: string; name: string } | null): FormData {
  const form = new FormData();
  const fields: Record<string, string> = {
    method: 'bank_transfer',
    currency: 'USD',
    sentOn: '2026-10-09',
    amountSent: '1000.00',
    senderName: CLIENT_NAME,
    senderCountry: '',
    transferReference: 'TRX-1001',
    transactionId: '',
    note: '',
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  if (receipt === undefined) {
    form.set('receipt', new File([PDF_BYTES], 'receipt.pdf', { type: 'application/pdf' }));
  } else if (receipt !== null) {
    form.set('receipt', new File([receipt.bytes], receipt.name, { type: receipt.type }));
  }
  return form;
}
