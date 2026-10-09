// Administrator API. Authentication routes are mounted separately from the protected data routes, so
// sign-in never passes through the session check. Every data route declares the permission it needs.

import { Hono } from 'hono';
import { ROLE_LABELS, ROLE_PERMISSIONS, type Permission, type Role } from '../../../shared/constants';
import {
  adminLoginSchema,
  bankProfilePatchSchema,
  bankProfileSchema,
  cancelInvoiceSchema,
  changePasswordSchema,
  clientProfileSchema,
  clientStatusSchema,
  enabledToggleSchema,
  invoiceCreateSchema,
  invoiceUpdateSchema,
  noteSchema,
  notificationPreviewSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  refundSchema,
  rejectSubmissionSchema,
  requestInfoSchema,
  userCreateSchema,
  userUpdateSchema,
  verifySubmissionSchema,
  westernUnionSchema,
} from '../../../shared/schemas';
import { SETTINGS_KEYS, type SettingsKey } from '../../../shared/settings';
import type { Deps } from '../../deps';
import { todayFor } from '../../deps';
import { badRequest, notFound } from '../../lib/errors';
import { parseInput } from '../../lib/validate';
import {
  adminChangePassword,
  adminLogin,
  adminLogout,
  confirmAdminPasswordLink,
  requestAdminPasswordReset,
} from '../../services/auth';
import { recordAudit } from '../../services/audit';
import { storeBrandingAsset } from '../../services/branding';
import {
  addNote,
} from '../../services/notes';
import {
  createClient,
  clientDetail,
  issueClientInvitation,
  listClients,
  resetClientAccessCode,
  setClientStatus,
  updateClient,
} from '../../services/clients';
import { ledgerCsv, listAuditEvents, adminDashboard, submissionsCsv } from '../../services/reports';
import {
  cancelInvoice,
  createInvoice,
  invoiceDetail,
  listInvoices,
  updateInvoice,
} from '../../services/invoices';
import {
  listSubmissions,
  recordRefund,
  rejectConfirmation,
  requestMoreInformation,
  receiptForAccess,
  startReview,
  submissionDetail,
  verifyConfirmation,
} from '../../services/payments';
import {
  createBankProfile,
  deleteBankProfile,
  listBankProfiles,
  listCurrencies,
  listMethodStates,
  getWesternUnion,
  saveWesternUnion,
  setCurrencyEnabled,
  setMethodEnabled,
  updateBankProfile,
  cardStatus,
} from '../../services/paymentConfig';
import { listNotifications, previewTemplate, retryNotification, sweepReminders } from '../../services/notifications';
import { discardDraft, publishSettings, readSettingsRows, saveDraft } from '../../services/settings';
import { createAdminUser, issueAdminResetLink, listAdminUsers, updateAdminUser } from '../../services/users';
import { ADMIN_COOKIE, clearSession, readJson, setSession, sessionToken, type AppEnv } from '../context';
import { adminSession, requireCsrf, requirePermission } from '../middleware';
import { actorFrom, deliverReceipt, multipartFields, parseQueryLimit, requireSameOrigin } from './shared';

function csvResponse(body: string, filename: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

function settingsKey(raw: string): SettingsKey {
  if (!(SETTINGS_KEYS as string[]).includes(raw)) throw notFound('That settings group does not exist.');
  return raw as SettingsKey;
}

export function adminAuthRoutes(deps: Deps) {
  const router = new Hono<AppEnv>();

  router.post('/auth/login', requireSameOrigin(deps), async (c) => {
    const input = parseInput(adminLoginSchema, await readJson(c));
    const session = await adminLogin(deps, { email: input.email, password: input.password, ip: c.get('ip') });
    setSession(c, ADMIN_COOKIE, session.token, session.expiresAt, deps.config.cookieSecure);
    return c.json({
      admin: { id: session.adminId, email: session.email, displayName: session.displayName, role: session.role, roleLabel: ROLE_LABELS[session.role as Role] },
      csrfToken: session.csrfToken,
      mustChangePassword: session.mustChangePassword,
      permissions: ROLE_PERMISSIONS[session.role as Role],
    });
  });

  router.get('/auth/session', adminSession(deps), (c) => {
    const admin = c.get('admin');
    return c.json({
      admin: { id: admin.id, email: admin.email, displayName: admin.displayName, role: admin.role, roleLabel: ROLE_LABELS[admin.role] },
      csrfToken: admin.csrfToken,
      mustChangePassword: admin.mustChangePassword,
      permissions: admin.permissions,
    });
  });

  router.post('/auth/logout', adminSession(deps), requireCsrf(deps, 'admin'), async (c) => {
    const token = sessionToken(c, ADMIN_COOKIE);
    if (token) await adminLogout(deps, token, actorFrom(deps, c, 'admin'));
    clearSession(c, ADMIN_COOKIE, deps.config.cookieSecure);
    return c.json({ ok: true });
  });

  router.post('/auth/change-password', adminSession(deps), requireCsrf(deps, 'admin'), async (c) => {
    const input = parseInput(changePasswordSchema, await readJson(c));
    const admin = c.get('admin');
    await adminChangePassword(deps, { adminId: admin.id, sessionId: admin.sessionId, currentPassword: input.currentPassword, newPassword: input.newPassword });
    return c.json({ ok: true });
  });

  router.post('/auth/password-reset/request', requireSameOrigin(deps), async (c) => {
    const input = parseInput(passwordResetRequestSchema, await readJson(c));
    await requestAdminPasswordReset(deps, { email: input.email, ip: c.get('ip') });
    return c.json({
      ok: true,
      message: 'If an administrator account exists for that email, a reset link has been sent.',
    }, 202);
  });

  router.post('/auth/password-reset/confirm', requireSameOrigin(deps), async (c) => {
    const input = parseInput(passwordResetConfirmSchema, await readJson(c));
    await confirmAdminPasswordLink(deps, { token: input.token, newPassword: input.newPassword });
    return c.json({ ok: true });
  });

  return router;
}

export function adminDataRoutes(deps: Deps) {
  const router = new Hono<AppEnv>();
  router.use('*', adminSession(deps), requireCsrf(deps, 'admin'));

  const actor = (c: Parameters<typeof actorFrom>[1]) => actorFrom(deps, c, 'admin');
  const now = () => deps.now();
  const guard = (permission: Permission) => requirePermission(permission);

  // Dashboard
  router.get('/dashboard', guard('dashboard:read'), async (c) => c.json(await adminDashboard(deps)));

  // Clients
  router.get('/clients', guard('clients:read'), async (c) =>
    c.json({ clients: await listClients(deps, { q: c.req.query('q') || undefined, status: c.req.query('status') || undefined }) }),
  );
  router.post('/clients', guard('clients:write'), async (c) => {
    const input = parseInput(clientProfileSchema, await readJson(c));
    return c.json({ client: await createClient(deps, input, actor(c)) }, 201);
  });
  router.get('/clients/:id', guard('clients:read'), async (c) => c.json(await clientDetail(deps, c.req.param('id'))));
  router.patch('/clients/:id', guard('clients:write'), async (c) => {
    const input = parseInput(clientProfileSchema, await readJson(c));
    return c.json({ client: await updateClient(deps, c.req.param('id'), input, actor(c)) });
  });
  router.post('/clients/:id/status', guard('clients:write'), async (c) => {
    const input = parseInput(clientStatusSchema, await readJson(c));
    await setClientStatus(deps, c.req.param('id'), input.status, actor(c));
    return c.json({ ok: true });
  });
  router.post('/clients/:id/invitation', guard('clients:write'), async (c) =>
    c.json(await issueClientInvitation(deps, c.req.param('id'), actor(c))),
  );
  router.post('/clients/:id/access-reset', guard('clients:write'), async (c) =>
    c.json(await resetClientAccessCode(deps, c.req.param('id'), actor(c))),
  );
  router.post('/clients/:id/notes', guard('notes:write'), async (c) => {
    const input = parseInput(noteSchema, await readJson(c));
    return c.json({ note: await addNote(deps.db, 'client', c.req.param('id'), input.body, actor(c), now()) }, 201);
  });

  // Invoices
  router.get('/invoices', guard('invoices:read'), async (c) =>
    c.json({ invoices: await listInvoices(deps, { q: c.req.query('q') || undefined, status: c.req.query('status') || undefined }) }),
  );
  router.post('/invoices', guard('invoices:write'), async (c) => {
    const input = parseInput(invoiceCreateSchema, await readJson(c));
    return c.json({ invoice: await createInvoice(deps, input, actor(c)) }, 201);
  });
  router.get('/invoices/:id', guard('invoices:read'), async (c) => c.json(await invoiceDetail(deps, c.req.param('id'))));
  router.patch('/invoices/:id', guard('invoices:write'), async (c) => {
    const input = parseInput(invoiceUpdateSchema, await readJson(c));
    return c.json({ invoice: await updateInvoice(deps, c.req.param('id'), input, actor(c)) });
  });
  router.post('/invoices/:id/cancel', guard('invoices:write'), async (c) => {
    const input = parseInput(cancelInvoiceSchema, await readJson(c));
    await cancelInvoice(deps, c.req.param('id'), input.reason, actor(c));
    return c.json({ ok: true });
  });
  router.post('/invoices/:id/notes', guard('notes:write'), async (c) => {
    const input = parseInput(noteSchema, await readJson(c));
    return c.json({ note: await addNote(deps.db, 'invoice', c.req.param('id'), input.body, actor(c), now()) }, 201);
  });
  router.post('/invoices/:id/refunds', guard('refunds:record'), async (c) => {
    const input = parseInput(refundSchema, await readJson(c));
    await recordRefund(deps, c.req.param('id'), { currency: input.currency, amount: input.amount, transferReference: input.transferReference, note: input.note }, actor(c));
    return c.json({ ok: true }, 201);
  });

  // Payment confirmations and review
  router.get('/submissions', guard('payments:read'), async (c) =>
    c.json({ submissions: await listSubmissions(deps, { status: c.req.query('status') || undefined, q: c.req.query('q') || undefined }) }),
  );
  router.get('/submissions/:id', guard('payments:read'), async (c) => c.json(await submissionDetail(deps, c.req.param('id'))));
  router.post('/submissions/:id/start-review', guard('payments:review'), async (c) => {
    await startReview(deps, c.req.param('id'), actor(c));
    return c.json({ ok: true });
  });
  router.post('/submissions/:id/request-info', guard('payments:review'), async (c) => {
    const input = parseInput(requestInfoSchema, await readJson(c));
    await requestMoreInformation(deps, c.req.param('id'), input.message, actor(c));
    return c.json({ ok: true });
  });
  router.post('/submissions/:id/reject', guard('payments:review'), async (c) => {
    const input = parseInput(rejectSubmissionSchema, await readJson(c));
    await rejectConfirmation(deps, c.req.param('id'), input.reason, actor(c));
    return c.json({ ok: true });
  });
  router.post('/submissions/:id/verify', guard('payments:review'), async (c) => {
    const input = parseInput(verifySubmissionSchema, await readJson(c));
    return c.json(await verifyConfirmation(deps, c.req.param('id'), { verifiedAmount: input.verifiedAmount, note: input.note }, actor(c)));
  });
  router.post('/submissions/:id/notes', guard('notes:write'), async (c) => {
    const input = parseInput(noteSchema, await readJson(c));
    return c.json({ note: await addNote(deps.db, 'submission', c.req.param('id'), input.body, actor(c), now()) }, 201);
  });

  // Receipts (private storage; access is audited)
  router.get('/receipts/:id', guard('receipts:read'), async (c) => {
    const id = c.req.param('id');
    const record = await receiptForAccess(deps.db, id, { admin: true });
    return deliverReceipt(c, deps, record, { actor: actor(c), receiptId: id });
  });

  // Agency settings: draft, preview, publish
  router.get('/settings', guard('settings:read'), async (c) => c.json({ settings: await readSettingsRows(deps.db) }));
  router.put('/settings/:key', guard('settings:write'), async (c) => {
    const key = settingsKey(c.req.param('key'));
    const value = await saveDraft(deps.db, key, await readJson(c), actor(c), now());
    return c.json({ draft: value });
  });
  router.post('/settings/:key/publish', guard('settings:write'), async (c) => {
    const key = settingsKey(c.req.param('key'));
    await publishSettings(deps.db, key, actor(c), now());
    return c.json({ ok: true });
  });
  router.post('/settings/:key/discard', guard('settings:write'), async (c) => {
    const key = settingsKey(c.req.param('key'));
    await discardDraft(deps.db, key, actor(c), now());
    return c.json({ ok: true });
  });
  router.post('/branding/assets', guard('settings:write'), async (c) => {
    const { fields, file } = await multipartFields(c);
    if (!file) throw badRequest('Choose a file to upload.');
    const kind = fields.kind === 'favicon' ? 'favicon' : fields.kind === 'logo' ? 'logo' : null;
    if (!kind) throw badRequest('Choose whether this is a logo or a favicon.');
    const asset = await storeBrandingAsset(deps.db, { kind, bytes: file.bytes, declaredType: file.declaredType, actor: actor(c), now: now() });
    return c.json({ asset: { id: asset.id, url: `/api/public/assets/${asset.id}`, contentType: asset.contentType, byteSize: asset.byteSize } }, 201);
  });
  router.post('/notifications/preview', guard('settings:read'), async (c) => {
    const input = parseInput(notificationPreviewSchema, await readJson(c));
    return c.json(previewTemplate(input.subject, input.body));
  });

  // Payment configuration
  router.get('/payment-config', guard('payments:read'), async (c) =>
    c.json({
      currencies: await listCurrencies(deps.db),
      methods: await listMethodStates(deps.db),
      bankProfiles: await listBankProfiles(deps.db),
      westernUnion: await getWesternUnion(deps.db),
      card: cardStatus(),
    }),
  );
  router.put('/payment-config/currencies/:code', guard('payment_config:write'), async (c) => {
    const input = parseInput(enabledToggleSchema, await readJson(c));
    await setCurrencyEnabled(deps.db, c.req.param('code'), input.enabled, actor(c), now());
    return c.json({ ok: true });
  });
  router.put('/payment-config/methods/:method', guard('payment_config:write'), async (c) => {
    const input = parseInput(enabledToggleSchema, await readJson(c));
    await setMethodEnabled(deps.db, c.req.param('method'), input.enabled, actor(c), now());
    return c.json({ ok: true });
  });
  router.post('/payment-config/bank-profiles', guard('payment_config:write'), async (c) => {
    const input = parseInput(bankProfileSchema, await readJson(c));
    return c.json({ profile: await createBankProfile(deps.db, input, actor(c), now()) }, 201);
  });
  router.patch('/payment-config/bank-profiles/:id', guard('payment_config:write'), async (c) => {
    const input = parseInput(bankProfilePatchSchema, await readJson(c));
    return c.json({ profile: await updateBankProfile(deps.db, c.req.param('id'), input, actor(c), now()) });
  });
  router.delete('/payment-config/bank-profiles/:id', guard('payment_config:write'), async (c) =>
    c.json({ result: await deleteBankProfile(deps.db, c.req.param('id'), actor(c), now()) }),
  );
  router.put('/payment-config/western-union', guard('payment_config:write'), async (c) => {
    const input = parseInput(westernUnionSchema, await readJson(c));
    return c.json({ westernUnion: await saveWesternUnion(deps.db, input, actor(c), now()) });
  });

  // Notifications
  router.get('/notifications', guard('notifications:read'), async (c) =>
    c.json({
      notifications: await listNotifications(deps.db, { status: c.req.query('status') || undefined }, 200),
      delivery: { configured: deps.mailer.configured },
    }),
  );
  router.post('/notifications/:id/retry', guard('notifications:write'), async (c) =>
    c.json({ outcome: await retryNotification(deps, c.req.param('id'), actor(c)) }),
  );
  router.post('/reminders/run', guard('notifications:write'), async (c) => c.json(await sweepReminders(deps)));

  // Audit log (read-only)
  router.get('/audit', guard('audit:read'), async (c) =>
    c.json({
      events: await listAuditEvents(deps.db, {
        entityType: c.req.query('entityType') || undefined,
        entityId: c.req.query('entityId') || undefined,
        action: c.req.query('action') || undefined,
        limit: parseQueryLimit(c.req.query('limit'), 100, 500),
      }),
    }),
  );

  // Reports
  router.get('/reports/submissions.csv', guard('reports:export'), async (c) => {
    const body = await submissionsCsv(deps.db, { from: c.req.query('from') || undefined, to: c.req.query('to') || undefined, status: c.req.query('status') || undefined });
    await recordAudit(deps.db, actor(c), { action: 'report.exported', summary: 'Exported submissions report', metadata: { report: 'submissions' } }, now());
    return csvResponse(body, `submissions-${todayFor(deps)}.csv`);
  });
  router.get('/reports/ledger.csv', guard('reports:export'), async (c) => {
    const body = await ledgerCsv(deps.db, { from: c.req.query('from') || undefined, to: c.req.query('to') || undefined });
    await recordAudit(deps.db, actor(c), { action: 'report.exported', summary: 'Exported ledger report', metadata: { report: 'ledger' } }, now());
    return csvResponse(body, `ledger-${todayFor(deps)}.csv`);
  });

  // Administrator accounts
  router.get('/users', guard('users:manage'), async (c) => c.json({ users: await listAdminUsers(deps.db) }));
  router.post('/users', guard('users:manage'), async (c) => {
    const input = parseInput(userCreateSchema, await readJson(c));
    return c.json(await createAdminUser(deps, input, actor(c)), 201);
  });
  router.patch('/users/:id', guard('users:manage'), async (c) => {
    const input = parseInput(userUpdateSchema, await readJson(c));
    await updateAdminUser(deps, c.req.param('id'), input, actor(c));
    return c.json({ ok: true });
  });
  router.post('/users/:id/reset-link', guard('users:manage'), async (c) => c.json(await issueAdminResetLink(deps, c.req.param('id'), actor(c))));

  return router;
}
