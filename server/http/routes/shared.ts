// Helpers shared by the route modules.

import type { Context, MiddlewareHandler } from 'hono';
import type { Deps } from '../../deps';
import { forbidden, notFound } from '../../lib/errors';
import { recordAudit, type Actor } from '../../services/audit';
import { ipHashFor } from '../../services/auth';
import type { AppEnv } from '../context';
import { isSameOrigin } from '../context';

/** Netlify synchronous functions accept request bodies up to 6 MB; receipts are capped at 5 MB inside that. */
export const MAX_MULTIPART_BYTES = 6 * 1024 * 1024;

export function actorFrom(deps: Deps, c: Context<AppEnv>, base: 'admin' | 'client'): Actor {
  const ipHash = ipHashFor(deps, c.get('ip'));
  return base === 'admin' ? { type: 'admin', id: c.get('admin').id, ipHash } : { type: 'client', id: c.get('client').id, ipHash };
}

/** Public state-changing endpoints (sign-in, activation) still require a same-origin request. */
export function requireSameOrigin(deps: Deps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!isSameOrigin(c, deps.config.appUrl)) {
      throw forbidden('This request came from an unexpected website. Refresh the page and try again.');
    }
    await next();
  };
}

export interface ReceiptRecord {
  storageKey: string;
  contentType: string;
  originalName: string;
}

/** Serves a receipt. Bytes are sent with a sandboxed policy; S3 downloads use a short-lived signed URL. */
export async function deliverReceipt(
  c: Context<AppEnv>,
  deps: Deps,
  record: ReceiptRecord | null,
  audit: { actor: Actor; receiptId: string },
): Promise<Response> {
  if (!record) throw notFound('We could not find that receipt.');
  const target = await deps.storage.open(record.storageKey, {
    filename: record.originalName,
    contentType: record.contentType,
  });
  await recordAudit(
    deps.db,
    audit.actor,
    { action: 'receipt.viewed', summary: 'Receipt opened', entityType: 'receipt', entityId: audit.receiptId },
    deps.now(),
  );
  if (target.kind === 'redirect') {
    c.header('Cache-Control', 'no-store');
    return c.redirect(target.url, 302);
  }
  c.header('Content-Type', target.contentType);
  c.header('Content-Disposition', `inline; filename="${target.filename.replace(/"/g, '')}"`);
  c.header('Content-Security-Policy', "default-src 'none'; sandbox");
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Cache-Control', 'private, no-store');
  return c.body(target.data as unknown as ArrayBuffer, 200);
}

export function parseQueryLimit(raw: string | undefined, fallback: number, max: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) return fallback;
  return Math.min(value, max);
}

export async function multipartFields(c: Context<AppEnv>): Promise<{
  fields: Record<string, string>;
  file: { bytes: Uint8Array; declaredType: string | null; name: string } | null;
}> {
  const form = await c.req.formData();
  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') fields[key] = value;
  }
  const part = form.get('receipt');
  let file: { bytes: Uint8Array; declaredType: string | null; name: string } | null = null;
  if (part instanceof File && part.size > 0) {
    file = { bytes: new Uint8Array(await part.arrayBuffer()), declaredType: part.type || null, name: part.name || 'receipt' };
  }
  return { fields, file };
}
