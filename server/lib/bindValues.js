/**
 * Statement-parameter sanitization shared by every driver.
 *
 * Both `node:sqlite` and libSQL refuse `boolean`/`undefined`, so the value
 * conversion has to happen before the driver sees it. Keeping it in one place
 * means a route can pass `true` or an omitted field anywhere in the app and
 * both drivers store the same thing (`1`/`0` and `NULL`).
 */
export function bind(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return value;
  if (typeof value === 'object' && !Array.isArray(value)) return JSON.stringify(value);
  return value;
}

export function bindAll(params) {
  if (!params) return [];
  const list = Array.isArray(params) ? params : [params];
  return list.map(bind);
}
