import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { z } from 'zod';
import { run, get, all, tx, isoNow, parseJson } from '../../db.js';
import { generatePaymentRef } from '../../lib/refs.js';
import { asyncHandler, badRequest, notFound, conflict, zodError } from '../../lib/http.js';
import { audit } from '../../lib/audit.js';
import { config } from '../../config.js';
import { requireClient } from '../../middleware/auth.js';
import { notifyFromTemplate } from '../../lib/notify.js';
import {
  getSetting,
  getCurrency,
  getEnabledCurrencies,
  getPaymentMethod,
  getPublicBranding,
} from '../../lib/settings.js';
import { buildBankTransferSnapshot, buildWesternUnionSnapshot, getAvailableMethodsForCurrency } from '../../lib/instructions.js';
import { formatMoney, parseAmountToCents } from '../../lib/money.js';
import { validateFileBuffer, storeFile, sha256, RECEIPT_MIME_TYPES, FileValidationError } from '../../lib/storage.js';
import { CARD_LABEL } from '../../lib/paymentConfig.js';

const router = Router();
router.use(requireClient);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
});

// ------------------------------------------------------------------ helpers

async function ownInvoiceOr404(clientId, invoiceId) {
  const invoice = await get('SELECT * FROM invoices WHERE id = ? AND client_id = ?', [invoiceId, clientId]);
  if (!invoice) throw notFound('Invoice not found.');
  return invoice;
}

async function ownReferenceOr404(clientId, refId) {
  const ref = await get('SELECT * FROM payment_references WHERE id = ? AND client_id = ?', [refId, clientId]);
  if (!ref) throw notFound('Payment reference not found.');
  return ref;
}

async function ownConfirmationOr404(clientId, confirmationId) {
  const row = await get('SELECT * FROM payment_confirmations WHERE id = ? AND client_id = ?', [confirmationId, clientId]);
  if (!row) throw notFound('Transaction not found.');
  return row;
}

function serializeReference(row) {
  return {
    id: row.id,
    refCode: row.ref_code,
    invoiceId: row.invoice_id,
    clientId: row.client_id,
    method: row.method,
    currency: row.currency,
    amountCents: row.amount_cents,
    amountFormatted: formatMoney(row.amount_cents, row.currency),
    status: row.status,
    instructionsSnapshot: parseJson(row.instructions_snapshot, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeConfirmation(row) {
  return {
    id: row.id,
    paymentReferenceId: row.payment_reference_id,
    refCode: row.ref_code,
    invoiceId: row.invoice_id,
    invoiceRef: row.invoice_ref,
    method: row.method,
    sentDate: row.sent_date,
    amountSentCents: row.amount_sent_cents,
    amountSentFormatted: formatMoney(row.amount_sent_cents, row.currency),
    currency: row.currency,
    senderName: row.sender_name,
    transferReference: row.transfer_reference,
    transactionId: row.transaction_id,
    note: row.note,
    status: row.status,
    rejectionReason: row.rejection_reason,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeReceipt(r) {
  return {
    id: r.id,
    originalFilename: r.original_filename,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    uploadedAt: r.uploaded_at,
  };
}

const CONFIRMATION_SQL = `
  SELECT pc.*, pr.ref_code, i.invoice_ref
    FROM payment_confirmations pc
    JOIN payment_references pr ON pr.id = pc.payment_reference_id
    JOIN invoices i ON i.id = pc.invoice_id
   WHERE pc.client_id = ?`;

// ---------------------------------------------------------------- dashboard

router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const clientId = req.portalClient.id;
    const client = await get('SELECT * FROM clients WHERE id = ?', [clientId]);
    const outstandingInvoices = (await all(
      `SELECT * FROM invoices WHERE client_id = ? AND status IN ('unpaid','awaiting_payment','confirmation_submitted','under_review','rejected','partially_paid')
        ORDER BY due_date ASC`,
      [clientId]
    )).map((r) => ({
      id: r.id,
      invoiceRef: r.invoice_ref,
      description: r.description,
      amountCents: r.amount_cents,
      amountFormatted: formatMoney(r.amount_cents, r.currency),
      currency: r.currency,
      dueDate: r.due_date,
      status: r.status,
    }));

    const totalsMap = new Map();
    for (const inv of outstandingInvoices) {
      totalsMap.set(inv.currency, (totalsMap.get(inv.currency) || 0) + inv.amountCents);
    }
    const outstandingTotals = [...totalsMap.entries()].map(([currency, cents]) => ({
      currency,
      cents,
      formatted: formatMoney(cents, currency),
    }));

    const recentConfirmations = await Promise.all(
      (await all(`${CONFIRMATION_SQL} ORDER BY pc.created_at DESC LIMIT 5`, [clientId])).map(serializeConfirmation)
    );

    // Recent status updates across this client's confirmations.
    const statusUpdates = await all(
      `SELECT h.*, pc.id AS confirmation_id, pr.ref_code
         FROM confirmation_status_history h
         JOIN payment_confirmations pc ON pc.id = h.confirmation_id
         JOIN payment_references pr ON pr.id = pc.payment_reference_id
        WHERE pc.client_id = ?
        ORDER BY h.created_at DESC LIMIT 10`,
      [clientId]
    );

    const branding = await getPublicBranding();
    res.json({
      client: {
        id: client.id,
        clientCode: client.client_code,
        fullName: client.full_name,
        email: client.email,
      },
      welcomeMessage: await getSetting('welcome_message') || '',
      outstandingInvoices,
      outstandingTotals,
      recentConfirmations,
      statusUpdates,
      support: {
        email: branding.supportEmail,
        phone: branding.supportPhone,
        whatsapp: branding.whatsappNumber,
        officeAddress: branding.officeAddress,
      },
      currencies: await getEnabledCurrencies(),
    });
  })
);

// ----------------------------------------------------------------- invoices

router.get(
  '/invoices',
  asyncHandler(async (req, res) => {
    const rows = await all('SELECT * FROM invoices WHERE client_id = ? ORDER BY created_at DESC', [req.portalClient.id]);
    res.json({
      invoices: rows.map((r) => ({
        id: r.id,
        invoiceRef: r.invoice_ref,
        description: r.description,
        amountCents: r.amount_cents,
        amountFormatted: formatMoney(r.amount_cents, r.currency),
        currency: r.currency,
        issueDate: r.issue_date,
        dueDate: r.due_date,
        status: r.status,
        allowPartial: !!r.allow_partial,
        notes: r.notes,
      })),
    });
  })
);

router.get(
  '/invoices/:id',
  asyncHandler(async (req, res) => {
    const invoice = await ownInvoiceOr404(req.portalClient.id, req.params.id);
    const lineItems = await all('SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY sort_order, id', [invoice.id]);
    const references = (await all(
      'SELECT * FROM payment_references WHERE invoice_id = ? ORDER BY created_at DESC',
      [invoice.id]
    )).map(serializeReference);
    const confirmations = await Promise.all(
      (await all(`${CONFIRMATION_SQL} AND pc.invoice_id = ? ORDER BY pc.created_at DESC`, [
        req.portalClient.id,
        invoice.id,
      ])).map(serializeConfirmation)
    );
    res.json({
      invoice: {
        id: invoice.id,
        invoiceRef: invoice.invoice_ref,
        description: invoice.description,
        amountCents: invoice.amount_cents,
        amountFormatted: formatMoney(invoice.amount_cents, invoice.currency),
        currency: invoice.currency,
        issueDate: invoice.issue_date,
        dueDate: invoice.due_date,
        status: invoice.status,
        allowPartial: !!invoice.allow_partial,
        notes: invoice.notes,
        lineItems: lineItems.map((li) => ({
          id: li.id,
          description: li.description,
          quantity: li.quantity,
          unitAmountCents: li.unit_amount_cents,
          totalCents: li.quantity * li.unit_amount_cents,
        })),
      },
      references,
      confirmations,
    });
  })
);

// --------------------------------------------------------- payment methods

router.get(
  '/payment-methods',
  asyncHandler(async (req, res) => {
    const invoiceId = Number(req.query.invoiceId);
    let currency = null;
    if (invoiceId) {
      const invoice = await ownInvoiceOr404(req.portalClient.id, invoiceId);
      currency = invoice.currency;
    }
    const methods = await getAvailableMethodsForCurrency(currency || 'USD');
    const settings = {
      requireReceiptUpload: !!await getSetting('require_receipt_upload'),
      requireSenderName: !!await getSetting('require_sender_name'),
      requireTransferReference: !!await getSetting('require_transfer_reference'),
      receiptMaxSizeMb: Number(await getSetting('receipt_max_size_mb')) || 10,
      allowedReceiptTypes: await getSetting('allowed_receipt_types') || ['pdf', 'jpg', 'jpeg', 'png'],
      cardLabel: CARD_LABEL,
    };
    res.json({
      invoiceCurrency: currency,
      methods: currency ? methods : methods.map((m) => ({ ...m, available: false, reason: 'Select an invoice first.' })),
      currencies: await getEnabledCurrencies(),
      settings,
    });
  })
);

// -------------------------------------------------------- payment references

router.post(
  '/payment-references',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      invoiceId: z.number().int().positive(),
      method: z.string().min(2).max(30),
      currency: z.string().length(3).transform((v) => v.toUpperCase()).optional(),
    });
    let body;
    try {
      body = schema.parse(req.body);
    } catch (e) {
      throw zodError(e);
    }

    const invoice = await ownInvoiceOr404(req.portalClient.id, body.invoiceId);
    if (!['unpaid', 'awaiting_payment', 'rejected'].includes(invoice.status)) {
      throw conflict(`This invoice cannot be paid in its current status ("${invoice.status}").`);
    }
    // No silent currency conversion: the payment currency must match the
    // invoice currency exactly.
    if (body.currency && body.currency !== invoice.currency) {
      throw badRequest(
        `This invoice is billed in ${invoice.currency}. Currency conversion is not supported — please pay in ${invoice.currency}.`
      );
    }
    const currencyRow = await getCurrency(invoice.currency);
    if (!currencyRow || !currencyRow.enabled) {
      throw badRequest(`Currency ${invoice.currency} is not currently enabled. Please contact support.`);
    }

    // The card option is always presented as unavailable in this version.
    if (body.method === 'card') {
      throw badRequest(`${CARD_LABEL}. Please choose bank transfer or Western Union instead.`);
    }

    const method = await getPaymentMethod(body.method);
    if (!method || !method.enabled) {
      throw badRequest('This payment method is not available.');
    }

    let snapshot = null;
    let bankProfileId = null;
    if (body.method === 'bank_transfer') {
      snapshot = await buildBankTransferSnapshot(invoice.currency);
      if (!snapshot) {
        throw badRequest(
          `Bank transfer instructions for ${invoice.currency} have not been configured yet. Please contact support.`
        );
      }
      bankProfileId = snapshot.profile.id;
    } else if (body.method === 'western_union') {
      snapshot = await buildWesternUnionSnapshot();
      if (!snapshot || !snapshot.currencies.includes(invoice.currency)) {
        throw badRequest(`Western Union transfers are not available for ${invoice.currency}. Please choose another method.`);
      }
    } else {
      throw badRequest('Unsupported payment method.');
    }

    const prefix = await getSetting('transaction_ref_prefix') || 'PAY';
    const refCode = await generatePaymentRef(prefix);
    const now = isoNow();
    snapshot.generatedAt = now;
    snapshot.amountCents = invoice.amount_cents;
    snapshot.invoiceRef = invoice.invoice_ref;

    const inserted = await run(
      `INSERT INTO payment_references (ref_code, invoice_id, client_id, method, currency, amount_cents, instructions_snapshot, bank_profile_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?)`,
      [
        refCode,
        invoice.id,
        req.portalClient.id,
        body.method,
        invoice.currency,
        invoice.amount_cents,
        JSON.stringify(snapshot),
        bankProfileId,
        now,
        now,
      ]
    );
    await run(`UPDATE invoices SET status = 'awaiting_payment', updated_at = ? WHERE id = ?`, [now, invoice.id]);
    await audit(req, {
      action: 'payment_instructions_issued',
      entity: 'payment_reference',
      entityId: inserted.lastInsertRowid,
      details: { refCode, method: body.method, currency: invoice.currency, amountCents: invoice.amount_cents },
    });
    await notifyFromTemplate('payment_instructions_issued', {
      vars: {
        client_name: req.portalClient.fullName,
        payment_ref: refCode,
        invoice_ref: invoice.invoice_ref,
        amount: formatMoney(invoice.amount_cents, invoice.currency),
        currency: invoice.currency,
      },
      fallbackSubject: `Payment instructions issued — ${refCode}`,
      fallbackBody: `Payment instructions were issued for ${refCode} (invoice ${invoice.invoice_ref}).`,
    });

    res.status(201).json({
      reference: serializeReference(await get('SELECT * FROM payment_references WHERE id = ?', [inserted.lastInsertRowid])),
    });
  })
);

router.get(
  '/payment-references/:id',
  asyncHandler(async (req, res) => {
    const ref = await ownReferenceOr404(req.portalClient.id, req.params.id);
    res.json({ reference: serializeReference(ref) });
  })
);

// ------------------------------------------------------------ confirmations

/**
 * On a serverless host the function itself refuses a request body over ~6 MB,
 * so an upload larger than that fails at the platform with an opaque error
 * before this app ever sees it. Clamping the application limit just below it
 * turns that into the normal, translatable "Receipt exceeds the maximum size of
 * 5 MB" response instead.
 */
export const SERVERLESS_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Configured per-receipt ceiling, in bytes, clamped for the host it runs on. */
export function receiptMaxBytes(configuredMb) {
  const bytes = (Number(configuredMb) || 10) * 1024 * 1024;
  return config.isServerless ? Math.min(bytes, SERVERLESS_MAX_UPLOAD_BYTES) : bytes;
}

async function receiptSettings() {
  const allowedTypes = await getSetting('allowed_receipt_types') || ['pdf', 'jpg', 'jpeg', 'png'];
  const allowed = {};
  for (const t of allowedTypes) {
    if (RECEIPT_MIME_TYPES[t]) allowed[t] = RECEIPT_MIME_TYPES[t];
  }
  if (Object.keys(allowed).length === 0) {
    for (const [k, v] of Object.entries(RECEIPT_MIME_TYPES)) allowed[k] = v;
  }
  return {
    allowed,
    maxBytes: receiptMaxBytes(await getSetting('receipt_max_size_mb')),
  };
}

async function storeReceipt({ buffer, originalName, confirmationId, clientId }) {
  const { allowed, maxBytes } = await receiptSettings();
  let validated;
  try {
    validated = validateFileBuffer({ buffer, originalName, allowed, maxBytes, label: 'Receipt' });
  } catch (e) {
    if ( e instanceof FileValidationError) throw badRequest(e.message);
    throw e;
  }
  const stored = await storeFile({ buffer, subdir: 'receipts', ext: validated.ext, contentType: validated.mime });
  await run(
    `INSERT INTO receipts (confirmation_id, client_id, original_filename, stored_filename, mime_type, size_bytes, sha256, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      confirmationId,
      clientId,
      path.basename(originalName || 'receipt'),
      stored.relativePath,
      validated.mime,
      buffer.length,
      sha256(buffer),
      isoNow(),
    ]
  );
  await audit(null, {
    actor: { type: 'client', id: clientId },
    action: 'receipt_uploaded',
    entity: 'receipt',
    entityId: confirmationId,
    details: { file: path.basename(originalName || 'receipt'), bytes: buffer.length, mime: validated.mime },
  });
  return stored;
}


router.post(
  '/confirmations',
  (req, res, next) => upload.single('receipt')(req, res, next),
  asyncHandler(async (req, res) => {
    const f = req.body || {};
    const schema = z.object({
      paymentReferenceId: z.coerce.number().int().positive(),
      sentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date sent must be YYYY-MM-DD.'),
      amountSent: z.string().min(1, 'Amount sent is required.'),
      currency: z.string().length(3).transform((v) => v.toUpperCase()),
      method: z.string().min(2).max(30),
      senderName: z.string().max(200).optional().or(z.literal('')),
      transferReference: z.string().max(200).optional().or(z.literal('')),
      transactionId: z.string().max(200).optional().or(z.literal('')),
      note: z.string().max(4000).optional().or(z.literal('')),
    });
    let body;
    try {
      body = schema.parse(f);
    } catch (e) {
      throw zodError(e);
    }

    // Idempotency: replaying the same key returns the original confirmation,
    // even if the payment reference has since moved on. This check runs before
    // any other validation so retries after a network failure are safe.
    const idempotencyKey = req.headers['idempotency-key']
      ? String(req.headers['idempotency-key']).slice(0, 120)
      : null;
    if (idempotencyKey) {
      const existing = await get('SELECT * FROM payment_confirmations WHERE idempotency_key = ?', [idempotencyKey]);
      if (existing && existing.client_id === req.portalClient.id) {
        const replayRow = await get(`${CONFIRMATION_SQL} AND pc.id = ?`, [req.portalClient.id, existing.id]);
        if (replayRow) {
          res.json({ confirmation: await serializeConfirmation(replayRow), idempotentReplay: true });
          return;
        }
      }
    }

    const reference = await ownReferenceOr404(req.portalClient.id, body.paymentReferenceId);
    if (!['issued', 'rejected', 'info_requested'].includes(reference.status)) {
      throw conflict('A confirmation for this payment reference is already being processed.');
    }
    const invoice = await get('SELECT * FROM invoices WHERE id = ?', [reference.invoice_id]);
    if (!invoice) throw notFound('Invoice not found.');

    // Validate against the server-trusted reference, never the browser.
    if (body.currency !== reference.currency) {
      throw badRequest(`The payment currency must be ${reference.currency} for this payment reference.`);
    }
    if (body.method !== reference.method) {
      throw badRequest('The payment method does not match the payment reference.');
    }
    const amountCents = parseAmountToCents(body.amountSent);
    if (amountCents === null || amountCents <= 0) {
      throw badRequest('Amount sent must be a valid positive amount (e.g. 1500.00).');
    }
    if (!invoice.allow_partial && amountCents < invoice.amount_cents) {
      throw badRequest(
        `This invoice requires full payment of ${formatMoney(invoice.amount_cents, invoice.currency)}. Partial payments are not enabled for this invoice.`
      );
    }
    if (new Date(body.sentDate) > new Date()) {
      throw badRequest('The date sent cannot be in the future.');
    }
    const snapshot = parseJson(reference.instructions_snapshot, {});
    const requireSender = await getSetting('require_sender_name') !== false;
    const requireTransferRef = await getSetting('require_transfer_reference') !== false;
    const wuMtcnRequired = reference.method === 'western_union' && snapshot.mtcnRequired !== false;
    const requireReceipt =
      await getSetting('require_receipt_upload') !== false ||
      (reference.method === 'western_union' && snapshot.receiptRequired !== false);
    if (requireSender && !body.senderName?.trim()) {
      throw badRequest('Sender / remitter name is required.');
    }
    if ((requireTransferRef || wuMtcnRequired) && !body.transferReference?.trim()) {
      throw badRequest(reference.method === 'western_union' ? 'The MTCN / transfer reference is required.' : 'The bank / transfer reference is required.');
    }
    if (requireReceipt && !req.file) {
      throw badRequest('Please upload a receipt or proof of transfer.');
    }

    const now = isoNow();
    const confirmationId = await tx(async () => {
      let inserted;
      try {
        inserted = await run(
          `INSERT INTO payment_confirmations
             (payment_reference_id, invoice_id, client_id, method, sent_date, amount_sent_cents, currency,
              sender_name, transfer_reference, transaction_id, note, status, idempotency_key, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?)`,
          [
            reference.id,
            invoice.id,
            req.portalClient.id,
            reference.method,
            body.sentDate,
            amountCents,
            reference.currency,
            body.senderName?.trim() || null,
            body.transferReference?.trim() || null,
            body.transactionId?.trim() || null,
            body.note?.trim() || null,
            idempotencyKey,
            now,
            now,
          ]
        );
      } catch (err) {
        if (String(err.message).includes('idx_confirmations_one_active')) {
          throw conflict('A confirmation for this payment reference is already under review.');
        }
        if (String(err.message).includes('idx_confirmations_idempotency')) {
          const existing = await get('SELECT * FROM payment_confirmations WHERE idempotency_key = ?', [idempotencyKey]);
          if (existing) throw conflict('This submission was already received.', { existingId: existing.id });
        }
        throw err;
      }
      const id = inserted.lastInsertRowid;
      if (req.file) {
        // Store the receipt inside the same transaction boundary of intent;
        // a storage failure rolls back the confirmation row.
        await storeReceipt({
          buffer: req.file.buffer,
          originalName: req.file.originalname,
          confirmationId: id,
          clientId: req.portalClient.id,
        });
      }
      await run(
        'INSERT INTO confirmation_status_history (confirmation_id, status, note, actor_type, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, 'submitted', 'Client submitted payment confirmation.', 'client', req.portalClient.id, now]
      );
      await run(`UPDATE payment_references SET status = 'confirmation_submitted', updated_at = ? WHERE id = ?`, [now, reference.id]);
      await run(`UPDATE invoices SET status = 'confirmation_submitted', updated_at = ? WHERE id = ?`, [now, invoice.id]);
      return id;
    });

    await audit(req, {
      action: 'payment_confirmation_submitted',
      entity: 'payment_confirmation',
      entityId: confirmationId,
      details: { refCode: reference.ref_code, method: reference.method, amountCents },
    });

    const row = await get(`${CONFIRMATION_SQL} AND pc.id = ?`, [req.portalClient.id, confirmationId]);
    if (await getSetting('notify_on_confirmation_submitted') !== false) {
      await notifyFromTemplate('payment_confirmation_submitted', {
        vars: {
          payment_ref: reference.ref_code,
          invoice_ref: invoice.invoice_ref,
          client_name: req.portalClient.fullName,
          client_code: req.portalClient.clientCode,
          amount: formatMoney(amountCents, reference.currency),
          currency: reference.currency,
          method: reference.method,
        },
        fallbackSubject: `Payment confirmation received — ${reference.ref_code}`,
        fallbackBody: `A payment confirmation was submitted for ${reference.ref_code} (invoice ${invoice.invoice_ref}, ${formatMoney(amountCents, reference.currency)} ${reference.currency}, method: ${reference.method}). Please review it in the admin portal.`,
      });
    }

    res.status(201).json({ confirmation: await serializeConfirmation(row) });
  })
);

router.get(
  '/confirmations',
  asyncHandler(async (req, res) => {
    const rows = await all(`${CONFIRMATION_SQL} ORDER BY pc.created_at DESC`, [req.portalClient.id]);
    res.json({ confirmations: await Promise.all(rows.map(serializeConfirmation)) });
  })
);

router.get(
  '/confirmations/:id',
  asyncHandler(async (req, res) => {
    const row = await get(`${CONFIRMATION_SQL} AND pc.id = ?`, [req.portalClient.id, req.params.id]);
    if (!row) throw notFound('Transaction not found.');
    const receipts = (await all('SELECT * FROM receipts WHERE confirmation_id = ? ORDER BY uploaded_at', [row.id])).map(serializeReceipt);
    const history = await all(
      'SELECT * FROM confirmation_status_history WHERE confirmation_id = ? ORDER BY created_at, id',
      [row.id]
    );
    const reference = await get('SELECT * FROM payment_references WHERE id = ?', [row.payment_reference_id]);
    res.json({
      confirmation: await serializeConfirmation(row),
      receipts,
      history,
      reference: reference ? serializeReference(reference) : null,
    });
  })
);

/** Attach an additional receipt to an existing confirmation (e.g. after a request). */
router.post(
  '/confirmations/:id/receipts',
  (req, res, next) => upload.single('receipt')(req, res, next),
  asyncHandler(async (req, res) => {
    const confirmation = await ownConfirmationOr404(req.portalClient.id, req.params.id);
    if (!['submitted', 'under_review', 'info_requested', 'rejected'].includes(confirmation.status)) {
      throw conflict('Receipts cannot be added to this transaction in its current status.');
    }
    if (!req.file) throw badRequest('Upload a receipt file (field name "receipt").');
    const MAX_RECEIPTS_PER_CONFIRMATION = 10;
    const existing = (await get('SELECT COUNT(*) AS n FROM receipts WHERE confirmation_id = ?', [confirmation.id])).n;
    if (existing >= MAX_RECEIPTS_PER_CONFIRMATION) {
      throw badRequest(`A transaction can have at most ${MAX_RECEIPTS_PER_CONFIRMATION} receipt files. Contact support if you need to replace one.`);
    }
    await storeReceipt({
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      confirmationId: confirmation.id,
      clientId: req.portalClient.id,
    });
    const receipts = (await all('SELECT * FROM receipts WHERE confirmation_id = ? ORDER BY uploaded_at', [confirmation.id])).map(serializeReceipt);
    res.status(201).json({ receipts });
  })
);

// -------------------------------------------------------------- transactions

router.get(
  '/transactions',
  asyncHandler(async (req, res) => {
    const references = await all(
      `SELECT pr.*, i.invoice_ref
         FROM payment_references pr JOIN invoices i ON i.id = pr.invoice_id
        WHERE pr.client_id = ? ORDER BY pr.created_at DESC`,
      [req.portalClient.id]
    );
    const confirmations = await all(`${CONFIRMATION_SQL} ORDER BY pc.created_at DESC`, [req.portalClient.id]);
    res.json({
      references: references.map((r) => ({ ...serializeReference(r), invoiceRef: r.invoice_ref })),
      confirmations: await Promise.all(confirmations.map(serializeConfirmation)),
    });
  })
);

export default router;
