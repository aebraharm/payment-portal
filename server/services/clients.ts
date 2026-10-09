// Client records, access management and activation. A client signs in with their full name plus a
// private access code. The access code is created by the client through a single-use invitation link,
// so the name alone never grants access.

import { ACCESS_CODE_MIN_LENGTH } from '../../shared/constants';
import type { Deps } from '../deps';
import { todayFor } from '../deps';
import type { Queryable } from '../db/database';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../lib/errors';
import { hashSecret } from '../security/passwords';
import { issueOneTimeToken, inspectOneTimeToken, redeemOneTimeToken } from '../security/oneTimeTokens';
import { revokeSessionsFor } from '../security/sessions';
import { recordAudit, type Actor } from './audit';
import { INVOICE_SUMMARY_SQL, requireUuid, toInvoiceSummary, type InvoiceSummaryRow } from './common';
import { brandContext, clientVisibleNotifications, listNotifications, notifySafely } from './notifications';
import { listNotes } from './notes';
import { readPublished } from './settings';

export const INVITATION_TTL_MINUTES = 7 * 24 * 60;

export function normalizeLoginName(fullName: string): string {
  return fullName
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export interface ClientRow {
  id: string;
  clientCode: string;
  fullName: string;
  email: string;
  phone: string;
  status: 'active' | 'suspended';
  hasAccessCode: boolean;
  invitationPending: boolean;
  openInvoices: number;
  createdAt: string;
}

export async function nextSequence(db: Queryable, name: string): Promise<number> {
  const { rows } = await db.query<{ value: string }>(
    `INSERT INTO sequences (name, value) VALUES ($1, 1)
     ON CONFLICT (name) DO UPDATE SET value = sequences.value + 1
     RETURNING value`,
    [name],
  );
  return Number(rows[0].value);
}

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export async function listClients(deps: Deps, filter: { q?: string; status?: string }): Promise<ClientRow[]> {
  const now = deps.now();
  const params: unknown[] = [now];
  const where: string[] = [];
  if (filter.q) {
    params.push(likePattern(filter.q));
    where.push(`(c.full_name ILIKE $${params.length} OR c.client_code ILIKE $${params.length} OR c.email ILIKE $${params.length})`);
  }
  if (filter.status === 'active' || filter.status === 'suspended') {
    params.push(filter.status);
    where.push(`c.status = $${params.length}`);
  }
  const { rows } = await deps.db.query<{
    id: string;
    client_code: string;
    full_name: string;
    email: string;
    phone: string;
    status: 'active' | 'suspended';
    has_access_code: boolean;
    invitation_pending: boolean;
    open_invoices: number;
    created_at: Date;
  }>(
    `SELECT c.id, c.client_code, c.full_name, c.email, c.phone, c.status, c.created_at,
            c.access_code_hash IS NOT NULL AS has_access_code,
            EXISTS (SELECT 1 FROM one_time_tokens t
                     WHERE t.subject_id = c.id AND t.purpose = 'client_invitation'
                       AND t.used_at IS NULL AND t.invalidated_at IS NULL AND t.expires_at > $1) AS invitation_pending,
            (SELECT COUNT(*)::int FROM invoices i WHERE i.client_id = c.id AND i.status = 'open') AS open_invoices
       FROM clients c
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY c.created_at DESC
      LIMIT 200`,
    params,
  );
  return rows.map((row) => ({
    id: row.id,
    clientCode: row.client_code,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    status: row.status,
    hasAccessCode: row.has_access_code,
    invitationPending: row.invitation_pending,
    openInvoices: row.open_invoices,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function getClient(db: Queryable, id: string): Promise<ClientRow & { loginName: string }> {
  const { rows } = await db.query<{
    id: string;
    client_code: string;
    full_name: string;
    login_name: string;
    email: string;
    phone: string;
    status: 'active' | 'suspended';
    has_access_code: boolean;
    created_at: Date;
  }>(
    `SELECT id, client_code, full_name, login_name, email, phone, status, created_at,
            access_code_hash IS NOT NULL AS has_access_code
       FROM clients WHERE id = $1`,
    [requireUuid(id, 'client')],
  );
  const row = rows[0];
  if (!row) throw notFound('That client does not exist.');
  return {
    id: row.id,
    clientCode: row.client_code,
    fullName: row.full_name,
    loginName: row.login_name,
    email: row.email,
    phone: row.phone,
    status: row.status,
    hasAccessCode: row.has_access_code,
    invitationPending: false,
    openInvoices: 0,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

async function assertLoginNameFree(db: Queryable, loginName: string, exceptId: string | null): Promise<void> {
  const { rows } = await db.query<{ id: string }>('SELECT id FROM clients WHERE login_name = $1', [loginName]);
  if (rows[0] && rows[0].id !== exceptId) {
    throw unprocessable('Another client already uses this full name. Each client needs a unique full name because it is their login.', {
      fullName: 'This name is already in use.',
    });
  }
}

export async function createClient(
  deps: Deps,
  input: { fullName: string; email: string; phone: string },
  actor: Actor,
): Promise<ClientRow> {
  const { db } = deps;
  const now = deps.now();
  const loginName = normalizeLoginName(input.fullName);
  await assertLoginNameFree(db, loginName, null);
  const sequence = await nextSequence(db, 'client_code');
  const clientCode = `CL-${String(sequence).padStart(6, '0')}`;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO clients (client_code, full_name, login_name, email, phone, status, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $7) RETURNING id`,
    [clientCode, input.fullName.trim(), loginName, input.email, input.phone, actor.id, now],
  );
  await recordAudit(
    db,
    actor,
    { action: 'client.created', summary: `Created client ${clientCode}`, entityType: 'client', entityId: rows[0].id },
    now,
  );
  const brand = await brandContext(deps);
  await notifySafely(deps, {
    templateKey: 'client_created',
    recipient: { type: 'client', clientId: rows[0].id, address: input.email },
    context: { agencyName: brand.agencyName, clientName: input.fullName.trim(), clientCode, supportEmail: brand.supportEmail },
    dedupeKey: `client-created:${rows[0].id}`,
  });
  return getClientSummary(deps, rows[0].id);
}

async function getClientSummary(deps: Deps, id: string): Promise<ClientRow> {
  const list = await listClients(deps, {});
  const found = list.find((row) => row.id === id);
  if (found) return found;
  const row = await getClient(deps.db, id);
  return { ...row, openInvoices: 0, invitationPending: false };
}

export async function updateClient(
  deps: Deps,
  id: string,
  input: { fullName: string; email: string; phone: string },
  actor: Actor,
): Promise<ClientRow> {
  const { db } = deps;
  const now = deps.now();
  const current = await getClient(db, id);
  const loginName = normalizeLoginName(input.fullName);
  if (loginName !== current.loginName) await assertLoginNameFree(db, loginName, id);
  await db.query(
    `UPDATE clients SET full_name = $2, login_name = $3, email = $4, phone = $5, updated_at = $6 WHERE id = $1`,
    [id, input.fullName.trim(), loginName, input.email, input.phone, now],
  );
  const changed = [
    current.fullName !== input.fullName.trim() ? 'fullName' : null,
    current.email !== input.email ? 'email' : null,
    current.phone !== input.phone ? 'phone' : null,
  ].filter(Boolean);
  await recordAudit(
    db,
    actor,
    { action: 'client.updated', summary: `Updated client ${current.clientCode}`, entityType: 'client', entityId: id, metadata: { changedFields: changed } },
    now,
  );
  return getClientSummary(deps, id);
}

export async function setClientStatus(deps: Deps, id: string, status: 'active' | 'suspended', actor: Actor): Promise<void> {
  const { db } = deps;
  const now = deps.now();
  const current = await getClient(db, id);
  if (current.status === status) return;
  await db.query('UPDATE clients SET status = $2, updated_at = $3 WHERE id = $1', [id, status, now]);
  if (status === 'suspended') {
    await revokeSessionsFor(db, { actorType: 'client', actorId: id, now });
  }
  await recordAudit(
    db,
    actor,
    {
      action: status === 'suspended' ? 'client.suspended' : 'client.reactivated',
      summary: `${status === 'suspended' ? 'Suspended' : 'Reactivated'} client ${current.clientCode}`,
      entityType: 'client',
      entityId: id,
    },
    now,
  );
}

async function sendInvitation(deps: Deps, clientId: string, actor: Actor, reason: string): Promise<{
  activationUrl: string;
  expiresAt: string;
  notification: string;
}> {
  const { db, config } = deps;
  const now = deps.now();
  const client = await getClient(db, clientId);
  if (client.status === 'suspended') {
    throw conflict('Reactivate this client before sending an invitation.');
  }
  const issued = await issueOneTimeToken(db, {
    purpose: 'client_invitation',
    subjectId: clientId,
    createdBy: actor.id,
    ttlMinutes: INVITATION_TTL_MINUTES,
    now,
  });
  const activationUrl = `${config.appUrl}/client/activate#token=${issued.token}`;
  const brand = await brandContext(deps);
  const settings = await readPublished(db);
  const outcome = await notifySafely(deps, {
    templateKey: 'client_invitation',
    recipient: { type: 'client', clientId, address: client.email },
    context: {
      agencyName: brand.agencyName,
      clientName: client.fullName,
      clientCode: client.clientCode,
      activationUrl,
      supportEmail: settings.contact.supportEmail,
    },
    dedupeKey: null,
  });
  await recordAudit(
    db,
    actor,
    {
      action: 'client.invitation_issued',
      summary: `Issued activation link for ${client.clientCode} (${reason})`,
      entityType: 'client',
      entityId: clientId,
      metadata: { expiresAt: issued.expiresAt.toISOString(), notification: outcome },
    },
    now,
  );
  return { activationUrl, expiresAt: issued.expiresAt.toISOString(), notification: outcome };
}

export async function issueClientInvitation(deps: Deps, clientId: string, actor: Actor) {
  return sendInvitation(deps, requireUuid(clientId, 'client'), actor, 'invitation');
}

export async function resetClientAccessCode(deps: Deps, clientId: string, actor: Actor) {
  const { db } = deps;
  const now = deps.now();
  requireUuid(clientId, 'client');
  const client = await getClient(db, clientId);
  await db.query('UPDATE clients SET access_code_hash = NULL, access_code_set_at = NULL, updated_at = $2 WHERE id = $1', [
    clientId,
    now,
  ]);
  await revokeSessionsFor(db, { actorType: 'client', actorId: clientId, now });
  await recordAudit(
    db,
    actor,
    { action: 'client.access_reset', summary: `Reset access code for ${client.clientCode}`, entityType: 'client', entityId: clientId },
    now,
  );
  return sendInvitation(deps, clientId, actor, 'access reset');
}

export async function inspectActivation(deps: Deps, token: string): Promise<{ valid: boolean; clientName: string | null; expiresAt: string | null }> {
  const found = await inspectOneTimeToken(deps.db, { purpose: 'client_invitation', token, now: deps.now() });
  if (!found) return { valid: false, clientName: null, expiresAt: null };
  const { rows } = await deps.db.query<{ full_name: string; status: string }>(
    'SELECT full_name, status FROM clients WHERE id = $1',
    [found.subjectId],
  );
  if (!rows[0] || rows[0].status !== 'active') return { valid: false, clientName: null, expiresAt: null };
  return { valid: true, clientName: rows[0].full_name, expiresAt: found.expiresAt.toISOString() };
}

export async function activateClient(deps: Deps, token: string, accessCode: string): Promise<{ clientName: string }> {
  if (accessCode.length < ACCESS_CODE_MIN_LENGTH) throw badRequest('Use a longer access code.');
  const { db } = deps;
  const now = deps.now();
  const hash = await hashSecret(accessCode);
  return db.transaction(async (tx) => {
    const clientId = await redeemOneTimeToken(tx, { purpose: 'client_invitation', token, now });
    if (!clientId) throw badRequest('This activation link is invalid or has expired. Ask the agency for a new link.');
    const { rows } = await tx.query<{ full_name: string; status: string }>(
      'SELECT full_name, status FROM clients WHERE id = $1 FOR UPDATE',
      [clientId],
    );
    if (!rows[0]) throw notFound('That client does not exist.');
    if (rows[0].status !== 'active') throw forbidden('This account is suspended. Contact the agency for help.');
    await tx.query(
      'UPDATE clients SET access_code_hash = $2, access_code_set_at = $3, updated_at = $3 WHERE id = $1',
      [clientId, hash, now],
    );
    await revokeSessionsFor(tx, { actorType: 'client', actorId: clientId, now });
    await recordAudit(
      tx,
      { type: 'client', id: clientId },
      { action: 'client.activated', summary: 'Client set an access code', entityType: 'client', entityId: clientId },
      now,
    );
    return { clientName: rows[0].full_name };
  });
}

export async function clientDetail(deps: Deps, id: string) {
  const { db } = deps;
  const client = await getClient(db, id);
  const today = todayFor(deps);
  const invoices = await db.query<InvoiceSummaryRow>(`${INVOICE_SUMMARY_SQL} WHERE i.client_id = $1 ORDER BY i.due_date DESC`, [id]);
  const audit = await db.query<{ id: string; occurred_at: Date; action: string; summary: string; actor_type: string }>(
    `SELECT id, occurred_at, action, summary, actor_type FROM audit_events
      WHERE entity_type = 'client' AND entity_id = $1 ORDER BY id DESC LIMIT 30`,
    [id],
  );
  return {
    client,
    invoices: invoices.rows.map((row) => toInvoiceSummary(row, today)),
    notes: await listNotes(db, 'client', id),
    notifications: await listNotifications(db, { clientId: id }, 30),
    clientVisibleNotifications: await clientVisibleNotifications(db, id),
    audit: audit.rows.map((row) => ({
      id: row.id,
      occurredAt: new Date(row.occurred_at).toISOString(),
      action: row.action,
      summary: row.summary,
      actorType: row.actor_type,
    })),
  };
}
