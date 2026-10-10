import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { bindAll } from '../bindValues.js';

/**
 * `node:sqlite` driver — a local database file. This is the VPS/container/dev
 * driver; it is also what the test suite runs against.
 *
 * The driver interface is intentionally tiny and identical for every driver:
 * a "connection" exposes `run` / `get` / `all`, plus `begin()` / `close()` /
 * `execScript()` on the driver itself. The async boundary lives in
 * `server/db.js`, so the sync SQLite calls are simply wrapped.
 */
export function createSqliteDriver({ file }) {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }

  const conn = {
    kind: 'sqlite',
    run(sql, params) {
      const result = db.prepare(sql).run(...bindAll(params));
      return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
    },
    get(sql, params) {
      return db.prepare(sql).get(...bindAll(params));
    },
    all(sql, params) {
      return db.prepare(sql).all(...bindAll(params));
    },
  };

  // One connection means one transaction at a time. Before the data layer went
  // async this was automatic — a `tx()` body ran to completion without ever
  // yielding. Now an `await` inside a transaction yields, so a second concurrent
  // `tx()` would issue BEGIN while the first was still open and the database
  // would answer "cannot start a transaction within a transaction". Queuing
  // restores the old guarantee: transactions are serialized, and reads outside
  // a transaction are unaffected (WAL lets readers run alongside a writer).
  let txQueue = Promise.resolve();

  return {
    kind: 'sqlite',
    defaultConn: conn,
    /**
     * SQLite serializes writers, so a transaction is just BEGIN IMMEDIATE on
     * the one connection. It is not reentrant: `server/db.js` nests `tx()`
     * calls onto the active transaction instead of starting a second one.
     */
    async begin() {
      const waitForPrevious = txQueue;
      let release;
      txQueue = new Promise((resolve) => {
        release = resolve;
      });
      await waitForPrevious;

      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        release();
      };
      try {
        db.exec('BEGIN IMMEDIATE');
      } catch (err) {
        done();
        throw err;
      }
      return {
        ...conn,
        async commit() {
          try {
            db.exec('COMMIT');
          } finally {
            done();
          }
        },
        async rollback() {
          try {
            db.exec('ROLLBACK');
          } catch {
            /* already rolled back */
          } finally {
            done();
          }
        },
      };
    },
    async execScript(sql) {
      db.exec(sql);
    },
    async close() {
      db.close();
    },
  };
}
