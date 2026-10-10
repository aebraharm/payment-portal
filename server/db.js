import { AsyncLocalStorage } from 'node:async_hooks';
import { config } from './config.js';

/**
 * The data layer. One API for both drivers (`node:sqlite` on a VPS, hosted
 * libSQL on Netlify), so `server/routes/**` is written once.
 *
 * Everything here is async: a network database cannot be queried
 * synchronously, and a serverless function must not block the event loop while
 * waiting on one. That is the single biggest change the Netlify migration made
 * to the codebase — route handlers and helpers `await` their queries.
 *
 * Transactions are carried in an `AsyncLocalStorage` rather than passed as an
 * argument, so `tx()` bodies keep calling `get()`/`run()` exactly as before and
 * still land on the transaction's connection. Without that, a query inside a
 * transaction would silently run outside it and a "payment verified" write could
 * commit on its own.
 */

const txStore = new AsyncLocalStorage();

let driverPromise = null;

async function driver() {
  if (!driverPromise) {
    driverPromise = (async () => {
      if (config.db.driver === 'libsql') {
        const { createLibsqlDriver } = await import('./lib/drivers/libsql.js');
        return createLibsqlDriver({
          url: config.db.url,
          authToken: config.db.authToken,
          timeoutMs: config.db.timeoutMs,
        });
      }
      const { createSqliteDriver } = await import('./lib/drivers/sqlite.js');
      return createSqliteDriver({ file: config.databasePath });
    })().catch((err) => {
      // Do not cache a failed connection: the next request should retry.
      driverPromise = null;
      throw err;
    });
  }
  return driverPromise;
}

async function activeConn() {
  const ambient = txStore.getStore();
  if (ambient) return ambient;
  return (await driver()).defaultConn;
}

export function isoNow() {
  return new Date().toISOString();
}

/** Run a statement that changes rows; returns { changes, lastInsertRowid }. */
export async function run(sql, params = []) {
  const conn = await activeConn();
  return conn.run(sql, params);
}

/** First matching row, or `undefined`. */
export async function get(sql, params = []) {
  const conn = await activeConn();
  return conn.get(sql, params);
}

/** All matching rows. */
export async function all(sql, params = []) {
  const conn = await activeConn();
  return conn.all(sql, params);
}

/**
 * Run `fn` inside one atomic write transaction and return its value.
 *
 * Nested `tx()` calls join the ambient transaction, so a helper that happens to
 * use `tx()` internally (reference generation does) cannot deadlock or commit
 * half of the caller's work.
 */
export async function tx(fn) {
  if (txStore.getStore()) return fn();

  const d = await driver();
  const conn = await d.begin();
  try {
    const result = await txStore.run(conn, () => Promise.resolve(fn()));
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  }
}

/** Execute a multi-statement SQL script (migrations only). */
export async function execScript(sql) {
  const d = await driver();
  return d.execScript(sql);
}

/** Active driver name, for status/health output. Never includes credentials. */
export async function driverKind() {
  return config.db.driver;
}

/** Close the connection and forget it (used by tests and shutdown). */
export async function closeDb() {
  const pending = driverPromise;
  driverPromise = null;
  if (!pending) return;
  const d = await pending;
  await d.close();
}

export function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function rowToBool(row, key) {
  if (!row || row[key] === undefined || row[key] === null) return undefined;
  row[key] = !!row[key];
  return row;
}
