/**
 * Hosted libSQL driver (Turso, or any libSQL/SQLite-over-HTTP endpoint).
 *
 * This is the driver that makes a serverless deployment possible: the database
 * is a network service, so it survives across function invocations, which a
 * local file on a read-only, ephemeral filesystem cannot. It speaks the same
 * SQLite dialect as `node:sqlite`, so no query or migration had to be forked.
 */
export async function createLibsqlDriver({ url, authToken, timeoutMs = 15000 }) {
  if (!url || !authToken) {
    throw new Error(
      '[db] DB_DRIVER=libsql requires TURSO_DATABASE_URL and TURSO_DATABASE_TOKEN to be set in the environment.'
    );
  }
  // Loaded lazily so the VPS path and the tests never need this package (it is
  // an optionalDependency) and never pay for bundling it.
  let mod;
  try {
    mod = await import('@libsql/client');
  } catch {
    throw new Error(
      '[db] DB_DRIVER=libsql needs the @libsql/client package. Install it with: npm install @libsql/client'
    );
  }
  const client = mod.createClient({ url, authToken, timeout: timeoutMs });

  const wrap = (executor) => ({
    kind: 'libsql',
    async run(sql, args = []) {
      const result = await executor({ sql, args });
      return {
        changes: Number(result.rowsAffected ?? 0),
        lastInsertRowid: result.lastInsertRowid === null || result.lastInsertRowid === undefined
          ? 0
          : Number(result.lastInsertRowid),
      };
    },
    async get(sql, args = []) {
      const result = await executor({ sql, args });
      return result.rows[0];
    },
    async all(sql, args = []) {
      const result = await executor({ sql, args });
      return result.rows;
    },
  });

  const defaultConn = wrap((stmt) => client.execute(stmt));

  return {
    kind: 'libsql',
    defaultConn,
    /**
     * A write transaction: statements run on one connection and commit
     * atomically. Conflicting concurrent writers are rejected by the database,
     * which `server/db.js` surfaces as a retryable `transaction_conflict`.
     */
    async begin() {
      const tx = await client.transaction('write');
      const conn = wrap((stmt) => tx.execute(stmt));
      let settled = false;
      return {
        ...conn,
        async commit() {
          if (settled) return;
          settled = true;
          await tx.commit();
        },
        async rollback() {
          if (settled) return;
          settled = true;
          try {
            await tx.rollback();
          } catch {
            /* already closed by the database */
          }
        },
      };
    },
    async execScript(sql) {
      await client.executeMultiple(sql);
    },
    async close() {
      await client.close();
    },
  };
}
