// Shared HTTP helpers: typed context, cookies, client IP and body parsing.

import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Permission, Role } from '../../shared/constants';
import type { Actor } from '../services/audit';
import { badRequest } from '../lib/errors';

export const ADMIN_COOKIE = 'pp_admin_session';
export const CLIENT_COOKIE = 'pp_client_session';

export interface AdminContext {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  mustChangePassword: boolean;
  sessionId: string;
  csrfToken: string;
  permissions: readonly Permission[];
}

export interface ClientContext {
  id: string;
  fullName: string;
  clientCode: string;
  sessionId: string;
  csrfToken: string;
}

export type AppEnv = {
  Variables: {
    admin: AdminContext;
    client: ClientContext;
    ip: string | null;
  };
};

export function clientIp(c: Context, trustProxyHeaders: boolean): string | null {
  if (trustProxyHeaders) {
    const netlify = c.req.header('x-nf-client-connection-ip');
    if (netlify) return netlify.trim();
    const forwarded = c.req.header('x-forwarded-for');
    if (forwarded) return forwarded.split(',')[0].trim();
  }
  const socket = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket;
  return socket?.remoteAddress ?? null;
}

export function setSession(c: Context, name: string, token: string, expiresAt: Date, secure: boolean): void {
  setCookie(c, name, token, {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    path: '/',
    expires: expiresAt,
  });
}

export function clearSession(c: Context, name: string, secure: boolean): void {
  deleteCookie(c, name, { httpOnly: true, secure, sameSite: 'Lax', path: '/' });
}

export function sessionToken(c: Context, name: string): string | undefined {
  const value = getCookie(c, name);
  return value && value.length >= 20 && value.length <= 200 ? value : undefined;
}

/** Same-origin check for state-changing requests. The CSRF token is the primary control; this is defence in depth. */
export function isSameOrigin(c: Context, appUrl: string): boolean {
  const origin = c.req.header('origin');
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const host = c.req.header('host');
    if (host && parsed.host === host) return true;
    return parsed.origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}

export async function readJson(c: Context): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json();
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
    return body as Record<string, unknown>;
  } catch {
    throw badRequest('The request could not be read. Refresh the page and try again.');
  }
}

export function adminActor(c: Context<AppEnv>, ipHash: string | null): Actor {
  return { type: 'admin', id: c.get('admin').id, ipHash };
}

export function clientActor(c: Context<AppEnv>, ipHash: string | null): Actor {
  return { type: 'client', id: c.get('client').id, ipHash };
}

export function requestHeaderKey(c: Context, name: string): string {
  return (c.req.header(name) ?? '').trim();
}
