import { run, get, tx, isoNow } from '../db.js';

/** Atomically increment a named sequence and return the new value. */
export async function nextSequence(name) {
  return await tx(async () => {
    const row = await get('SELECT value FROM sequences WHERE name = ?', [name]);
    const next = (row ? Number(row.value) : 0) + 1;
    if (row) {
      await run('UPDATE sequences SET value = ? WHERE name = ?', [next, name]);
    } else {
      await run('INSERT INTO sequences (name, value) VALUES (?, ?)', [name, next]);
    }
    return next;
  });
}

function yearStamp() {
  return new Date().getUTCFullYear();
}

function padded(n, width = 4) {
  return String(n).padStart(width, '0');
}

/** Generate a unique client code, e.g. CL-2026-0007 */
export async function generateClientCode() {
  const seq = await nextSequence(`client_code_${yearStamp()}`);
  return `CL-${yearStamp()}-${padded(seq)}`;
}

/** Generate a unique invoice reference using the configured prefix. */
export async function generateInvoiceRef(prefix = 'INV') {
  const seq = await nextSequence(`invoice_ref_${yearStamp()}`);
  return `${prefix}-${yearStamp()}-${padded(seq)}`;
}

/** Generate a unique payment (transaction) reference using the configured prefix. */
export async function generatePaymentRef(prefix = 'PAY') {
  const seq = await nextSequence(`payment_ref_${yearStamp()}`);
  return `${prefix}-${yearStamp()}-${padded(seq)}`;
}

export { isoNow };
