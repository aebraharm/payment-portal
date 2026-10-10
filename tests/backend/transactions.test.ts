import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { run, get, all, tx, closeDb } from '../../server/db.js';
import { seedDatabase } from '../../server/seed.js';
import { isoNow } from '../../server/db.js';
import { makeApp, loginAdmin, createClient, createInvoice, createUsdProfile, loginClient, submitConfirmation } from './helpers.js';
import { resetHandlerCache } from '../../server/lib/serverlessAdapter.js';

/**
 * The data layer became asynchronous as part of the Netlify migration, and that
 * changes what "atomic" depends on: a transaction is now a *promise*, so an
 * accidentally un-awaited `tx()` would let a second request read half-written
 * state, and a query issued after an `await` inside a transaction must still run
 * on the transaction's connection. These tests pin exactly that.
 */
beforeAll(async () => {
  await seedDatabase();
  resetHandlerCache();
});

afterAll(async () => {
  await closeDb();
});

describe('transactions through the async facade', () => {
  it('commits every write made inside tx(), in order', async () => {
    const before = (await get('SELECT COUNT(*) AS n FROM clients')).n;
    const created = await tx(async () => {
      const inserted = await run(
        `INSERT INTO clients (client_code, full_name, email, status, access_code_hash, created_at, updated_at)
         VALUES ('TX-OK-1', 'Tx Ok Client', 'tx1@example.com', 'active', 'x', ?, ?)`,
        [isoNow(), isoNow()]
      );
      await run('UPDATE clients SET notes = ? WHERE id = ?', ['written inside the transaction', inserted.lastInsertRowid]);
      return inserted.lastInsertRowid;
    });
    expect(created).toBeGreaterThan(0);
    const row = await get('SELECT * FROM clients WHERE id = ?', [created]);
    expect(row.notes).toBe('written inside the transaction');
    expect((await get('SELECT COUNT(*) AS n FROM clients')).n).toBe(before + 1);
  });

  it('rolls the whole transaction back when the body rejects', async () => {
    const before = (await get('SELECT COUNT(*) AS n FROM clients')).n;
    await expect(
      tx(async () => {
        await run(
          `INSERT INTO clients (client_code, full_name, email, status, access_code_hash, created_at, updated_at)
           VALUES ('TX-ROLL-1', 'Tx Rollback', 'roll@example.com', 'active', 'x', ?, ?)`,
          [isoNow(), isoNow()]
        );
        const count = (await get('SELECT COUNT(*) AS n FROM clients WHERE client_code = ?', ['TX-ROLL-1'])).n;
        expect(count).toBe(1); // visible inside the transaction
        throw new Error('deliberate failure after a write');
      })
    ).rejects.toThrow('deliberate failure after a write');
    // Gone: not merely "uncommitted", actually absent.
    expect((await get('SELECT COUNT(*) AS n FROM clients WHERE client_code = ?', ['TX-ROLL-1']))?.n ?? 0).toBe(0);
    expect((await get('SELECT COUNT(*) AS n FROM clients')).n).toBe(before);
  });

  it('keeps a nested tx() inside the outer transaction instead of committing early', async () => {
    // Reference generation opens its own tx() to allocate a sequence number. If
    // that committed independently, a rolled-back invoice would still burn a
    // reference number — and could commit the row it was supposed to discard.
    const before = (await get('SELECT COUNT(*) AS n FROM sequences')).n;
    await expect(
      tx(async () => {
        const seqRow = await get('SELECT name FROM sequences LIMIT 1');
        void seqRow;
        await run('INSERT INTO sequences (name, value) VALUES (?, ?)', ['nested_probe', 1]);
        // Re-entering tx() must be a no-op wrapper, not a new transaction.
        await tx(async () => {
          await run('UPDATE sequences SET value = ? WHERE name = ?', [99, 'nested_probe']);
        });
        throw new Error('rollback with nested work');
      })
    ).rejects.toThrow('rollback with nested work');
    expect(await get('SELECT * FROM sequences WHERE name = ?', ['nested_probe'])).toBeUndefined();
    expect((await get('SELECT COUNT(*) AS n FROM sequences')).n).toBe(before);
  });

  it('does not leak a transaction onto unrelated concurrent work', async () => {
    // The transaction connection travels in AsyncLocalStorage. If that context
    // bled into a sibling request, an outside reader would see uncommitted rows
    // (or write into a transaction that later rolls back).
    let insideVisibleFromOutside = false;
    const slow = tx(async () => {
      await run(
        `INSERT INTO clients (client_code, full_name, email, status, access_code_hash, created_at, updated_at)
         VALUES ('TX-ISOLATE', 'Tx Isolate', 'iso@example.com', 'active', 'x', ?, ?)`,
        [isoNow(), isoNow()]
      );
      await new Promise((resolve) => setTimeout(resolve, 30));
      return true;
    });
    // Concurrent, outside the transaction.
    const outside = await get('SELECT * FROM clients WHERE client_code = ?', ['TX-ISOLATE']);
    insideVisibleFromOutside = !!outside;
    await slow;
    expect(insideVisibleFromOutside).toBe(false);
    expect(await get('SELECT * FROM clients WHERE client_code = ?', ['TX-ISOLATE'])).toBeTruthy();
    await run('DELETE FROM clients WHERE client_code = ?', ['TX-ISOLATE']);
  });

  it('allocates unique sequence values under concurrent transactions', async () => {
    // Ten parallel allocations are the serverless case in miniature: separate
    // invocations, one shared database, one row to increment.
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        tx(async () => {
          const row = await get('SELECT value FROM sequences WHERE name = ?', ['concurrent_probe']);
          const next = (row ? Number(row.value) : 0) + 1;
          if (row) await run('UPDATE sequences SET value = ? WHERE name = ?', [next, 'concurrent_probe']);
          else await run('INSERT INTO sequences (name, value) VALUES (?, ?)', ['concurrent_probe', next]);
          return next;
        })
      )
    );
    expect(new Set(results).size).toBe(10);
    expect(results.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    await run('DELETE FROM sequences WHERE name = ?', ['concurrent_probe']);
  });

  it('rejects a second verification of the same payment (atomic status check)', async () => {
    const app = await makeApp();
    const { agent } = await loginAdmin(app);
    await createUsdProfile(agent);
    const client = await createClient(agent, 'Double Verify Client');
    const invoice = await createInvoice(agent, client.id);
    const clientAgent = await loginClient(app, client);
    const reference = await clientAgent.post('/api/client/payment-references').send({
      invoiceId: invoice.id,
      method: 'bank_transfer',
      currency: 'USD',
    });
    const confirmation = await submitConfirmation(clientAgent, reference.body.reference.id);
    expect(confirmation.status).toBe(201);
    const confirmationId = confirmation.body.confirmation.id;

    const attempts = await Promise.all([
      agent.post(`/api/admin/transactions/${confirmationId}/review`).send({ action: 'verified' }),
      agent.post(`/api/admin/transactions/${confirmationId}/review`).send({ action: 'verified' }),
      agent.post(`/api/admin/transactions/${confirmationId}/review`).send({ action: 'verified' }),
    ]);
    const successes = attempts.filter((r) => r.status === 200);
    expect(successes.length).toBe(1);
    for (const failed of attempts.filter((r) => r.status !== 200)) {
      // The loser sees the status it arrived to find already changed. The point
      // is that exactly one review applies: a paid transfer must not be counted
      // twice because two administrators clicked at the same moment.
      expect(failed.status).toBe(400);
      expect(failed.body.error.message).toMatch(/Cannot review a transaction with status "verified"./);
    }

    const rows = await all('SELECT status FROM payment_confirmations WHERE id = ?', [confirmationId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('verified');
    const history = await all(
      'SELECT status FROM confirmation_status_history WHERE confirmation_id = ? ORDER BY created_at, id',
      [confirmationId]
    );
    // One transition record per accepted action, never one per attempt.
    expect(history.filter((h) => h.status === 'verified')).toHaveLength(1);
  }, 30000);
});
