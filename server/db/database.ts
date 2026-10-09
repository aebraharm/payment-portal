// Database access layer. Production uses PostgreSQL through node-postgres. Local development and
// tests use PGlite (PostgreSQL compiled to WASM) so the same SQL runs everywhere. Both expose the same
// minimal interface, and all SQL uses parameterised queries.

import { mkdir } from 'node:fs/promises';
import pg from 'pg';

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface Queryable {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<T = any>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
}

export interface Database extends Queryable {
  readonly kind: 'postgres' | 'pglite';
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function createPostgresDatabase(
  connectionString: string,
  options: { ssl?: boolean; maxConnections?: number } = {},
): Promise<Database> {
  // Keep DATE values as ISO strings so business dates never shift with the server timezone.
  pg.types.setTypeParser(1082, (value) => value);

  const pool = new pg.Pool({
    connectionString,
    max: options.maxConnections ?? 5,
    idleTimeoutMillis: 10_000,
    ssl: options.ssl ? { rejectUnauthorized: true } : undefined,
  });

  const wrap = (runner: Pick<pg.Pool, 'query'>): Queryable => ({
    async query(sql, params) {
      const result = await runner.query(sql, params as unknown[] | undefined);
      return { rows: result.rows, rowCount: result.rowCount ?? 0 };
    },
    async exec(sql) {
      await runner.query(sql);
    },
  });

  const base = wrap(pool);
  return {
    kind: 'postgres',
    query: base.query,
    exec: base.exec,
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(wrap(client));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

export async function createPgliteDatabase(dataDir?: string): Promise<Database> {
  const { PGlite } = await import('@electric-sql/pglite');
  // The embedded engine does not create missing parent directories itself.
  if (dataDir) await mkdir(dataDir, { recursive: true });
  const engine = dataDir ? new PGlite(dataDir) : new PGlite();
  await engine.waitReady;

  const toResult = <T>(result: { rows: T[]; affectedRows?: number }): QueryResult<T> => ({
    rows: result.rows,
    // PGlite reports affectedRows = 0 for SELECT statements, so take the larger of the two counts.
    rowCount: Math.max(result.rows.length, result.affectedRows ?? 0),
  });

  const queryable = (runner: {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; affectedRows?: number }>;
    exec: (sql: string) => Promise<unknown>;
  }): Queryable => ({
    async query(sql, params) {
      return toResult(await runner.query(sql, params) as { rows: never[]; affectedRows?: number });
    },
    async exec(sql) {
      await runner.exec(sql);
    },
  });

  const base = queryable(engine as unknown as Parameters<typeof queryable>[0]);
  return {
    kind: 'pglite',
    query: base.query,
    exec: base.exec,
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      return engine.transaction(async (tx) =>
        fn(queryable(tx as unknown as Parameters<typeof queryable>[0])),
      );
    },
    async close() {
      await engine.close();
    },
  };
}
