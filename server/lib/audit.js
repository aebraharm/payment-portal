import { run, isoNow } from '../db.js';

/**
 * Append an audit-log entry. `details` is sanitized: password, token and
 * access-code fields are stripped before persistence.
 */
const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'password_hash',
  'accesscode',
  'access_code',
  'accesscodehash',
  'access_code_hash',
  'token',
  'tokenhash',
  'token_hash',
  'secret',
  'apikey',
  'api_key',
  'cvv',
  'cardnumber',
  'card_number',
]);

function sanitize(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    // Redact anything that looks like an 8-char access code is overkill; the
    // main risk is credential-shaped fields, handled by key names below.
    return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  }
  if (typeof value !== 'object' || depth > 4) return '[truncated]';
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase().replace(/[._-]/g, ''))) {
      out[k] = '[redacted]';
    } else {
      out[k] = sanitize(v, depth + 1);
    }
  }
  return out;
}

export function audit(req, { actor, action, entity, entityId, details }) {
  let actorType = 'system';
  let actorId = null;
  if (actor) {
    actorType = actor.type;
    actorId = actor.id;
  } else if (req?.admin) {
    actorType = 'admin';
    actorId = req.admin.id;
  } else if (req?.portalClient) {
    actorType = 'client';
    actorId = req.portalClient.id;
  }
  try {
    run(
      `INSERT INTO audit_logs (actor_type, actor_id, action, entity, entity_id, details, ip, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actorType,
        actorId,
        action,
        entity || null,
        entityId !== undefined && entityId !== null ? String(entityId) : null,
        details !== undefined ? JSON.stringify(sanitize(details)) : null,
        req?.ip || null,
        req?.headers?.['user-agent']?.slice(0, 300) || null,
        isoNow(),
      ]
    );
  } catch (err) {
    // Audit logging must never break the request path.
    console.error('[audit] failed to write audit log:', err.message);
  }
}
