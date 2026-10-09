import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

let db = null;

export function isoNow() {
  return new Date().toISOString();
}

/**
 * Sanitize a JS value for node:sqlite binding (no booleans/undefined allowed).
 */
function bind(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  return value;
}

function bindAll(params) {
  if (!params) return [];
  const list = Array.isArray(params) ? params : [params];
  return list.map(bind);
}

export function getDb() {
  if (db) return db;
  if (config.databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  }
  db = new DatabaseSync(config.databasePath);
  db.exec('PRAGMA foreign_keys = ON;');
  if (config.databasePath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  return db;
}

/** Close the current connection (used by tests). */
export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

export function run(sql, params = []) {
  const stmt = getDb().prepare(sql);
  const result = stmt.run(...bindAll(params));
  return {
    changes: Number(result.changes),
    lastInsertRowid: Number(result.lastInsertRowid),
  };
}

export function get(sql, params = []) {
  return getDb().prepare(sql).get(...bindAll(params));
}

export function all(sql, params = []) {
  return getDb().prepare(sql).all(...bindAll(params));
}

/** Run a function inside a write transaction (SQLite serializes writers). */
export function tx(fn) {
  const conn = getDb();
  conn.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    conn.exec('COMMIT');
    return result;
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }
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
