// Client portal API. Clients sign in with their full name and access code. Activation links are how
// the access code is first set, and the name alone never grants access.

import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  activationInspectSchema,
  activationSchema,
  changeAccessCodeSchema,
  clientLoginSchema,
  referenceCreateSchema,
} from '../../../shared/schemas';
import type { Deps } from '../../deps';
import { parseInput } from '../../lib/validate';
import { activateClient, inspectActivation } from '../../services/clients';
import { clientChangeAccessCode, clientLogin } from '../../services/auth';
import { clientDashboard, clientInvoiceDetail } from '../../services/clientPortal';
import { recordAudit } from '../../services/audit';
import { getClientReference, issueReference, listClientReferences, receiptForAccess, submitConfirmation } from '../../services/payments';
import { revokeSessionByToken } from '../../security/sessions';
import { CLIENT_COOKIE, clearSession, readJson, setSession, sessionToken, type AppEnv } from '../context';
import { clientSession, requireCsrf } from '../middleware';
import { MAX_MULTIPART_BYTES, actorFrom, deliverReceipt, multipartFields, requireSameOrigin } from './shared';

export function clientAuthRoutes(deps: Deps) {
  const router = new Hono<AppEnv>();

  router.post('/auth/login', requireSameOrigin(deps), async (c) => {
    const input = parseInput(clientLoginSchema, await readJson(c));
    const session = await clientLogin(deps, { fullName: input.fullName, accessCode: input.accessCode, ip: c.get('ip') });
    setSession(c, CLIENT_COOKIE, session.token, session.expiresAt, deps.config.cookieSecure);
    return c.json({ client: { id: session.clientId, fullName: session.clientName }, csrfToken: session.csrfToken });
  });

  router.get('/auth/session', clientSession(deps), (c) => {
    const client = c.get('client');
    return c.json({
      client: { id: client.id, fullName: client.fullName, clientCode: client.clientCode },
      csrfToken: client.csrfToken,
    });
  });

  router.post('/auth/logout', clientSession(deps), requireCsrf(deps, 'client'), async (c) => {
    const token = sessionToken(c, CLIENT_COOKIE);
    const client = c.get('client');
    if (token) {
      await revokeSessionByToken(deps.db, token, deps.now());
      await recordAudit(deps.db, { type: 'client', id: client.id }, { action: 'client.logout', summary: 'Client signed out' }, deps.now());
    }
    clearSession(c, CLIENT_COOKIE, deps.config.cookieSecure);
    return c.json({ ok: true });
  });

  router.post('/auth/change-access-code', clientSession(deps), requireCsrf(deps, 'client'), async (c) => {
    const input = parseInput(changeAccessCodeSchema, await readJson(c));
    const client = c.get('client');
    await clientChangeAccessCode(deps, {
      clientId: client.id,
      sessionId: client.sessionId,
      currentAccessCode: input.currentAccessCode,
      newAccessCode: input.newAccessCode,
    });
    return c.json({ ok: true });
  });

  // Activation: the token travels in the URL fragment and in the request body, never in a query string.
  router.post('/auth/activation/inspect', requireSameOrigin(deps), async (c) => {
    const input = parseInput(activationInspectSchema, await readJson(c));
    return c.json(await inspectActivation(deps, input.token));
  });

  router.post('/auth/activation/complete', requireSameOrigin(deps), async (c) => {
    const input = parseInput(activationSchema, await readJson(c));
    return c.json(await activateClient(deps, input.token, input.accessCode));
  });

  return router;
}

export function clientDataRoutes(deps: Deps) {
  const router = new Hono<AppEnv>();
  router.use('*', clientSession(deps), requireCsrf(deps, 'client'));

  router.get('/dashboard', async (c) => c.json(await clientDashboard(deps, c.get('client').id)));

  router.get('/invoices/:id', async (c) => c.json(await clientInvoiceDetail(deps, c.get('client').id, c.req.param('id'))));

  router.post('/invoices/:id/references', async (c) => {
    const input = parseInput(referenceCreateSchema, await readJson(c));
    const result = await issueReference(deps, c.get('client').id, c.req.param('id'), input, c.req.header('idempotency-key') ?? '');
    return c.json(result, result.created ? 201 : 200);
  });

  router.get('/references', async (c) =>
    c.json({ references: await listClientReferences(deps, c.get('client').id, c.req.query('invoiceId') || undefined) }),
  );

  router.get('/references/:id', async (c) => c.json({ reference: await getClientReference(deps, c.get('client').id, c.req.param('id')) }));

  router.post(
    '/references/:id/submissions',
    bodyLimit({
      maxSize: MAX_MULTIPART_BYTES,
      onError: (c) =>
        c.json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'The upload is too large. Receipts must be 5 MB or smaller.' } }, 413),
    }),
    async (c) => {
      const { fields, file } = await multipartFields(c);
      const result = await submitConfirmation(deps, c.get('client').id, c.req.param('id'), fields, file, c.req.header('idempotency-key') ?? '');
      return c.json(result, result.replayed ? 200 : 201);
    },
  );

  router.get('/receipts/:id', async (c) => {
    const id = c.req.param('id');
    const record = await receiptForAccess(deps.db, id, { clientId: c.get('client').id });
    return deliverReceipt(c, deps, record, { actor: actorFrom(deps, c, 'client'), receiptId: id });
  });

  return router;
}
