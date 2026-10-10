import { Router } from 'express';
import { z } from 'zod';
import { run, get, all, isoNow, parseJson } from '../../db.js';
import { asyncHandler, badRequest, notFound, conflict, zodError } from '../../lib/http.js';
import { audit } from '../../lib/audit.js';
import { requireAdmin, requireRole } from '../../middleware/auth.js';
import {
  CURRENCY_FIELDS,
  TRANSFER_TYPES,
  WU_SENDER_INFO_OPTIONS,
  WU_RECIPIENT_INFO_OPTIONS,
  CARD_LABEL,
  validateInstructionFields,
} from '../../lib/paymentConfig.js';

const router = Router();
router.use(requireAdmin);
// Configuration changes are privileged: admin or superadmin (not reviewer).
const requireConfigRole = requireRole('superadmin', 'admin');

// ------------------------------------------------------------ schema API ---

router.get(
  '/payment-config/schema',
  asyncHandler(async (_req, res) => {
    res.json({
      currencyFields: CURRENCY_FIELDS,
      transferTypes: TRANSFER_TYPES,
      wuSenderInfoOptions: WU_SENDER_INFO_OPTIONS,
      wuRecipientInfoOptions: WU_RECIPIENT_INFO_OPTIONS,
      cardLabel: CARD_LABEL,
    });
  })
);

// ------------------------------------------------------------- currencies --

router.get(
  '/currencies',
  asyncHandler(async (_req, res) => {
    const rows = await all('SELECT * FROM currencies ORDER BY sort_order, code');
    res.json({
      currencies: rows.map((r) => ({ ...r, enabled: !!r.enabled })),
    });
  })
);

router.put(
  '/currencies',
  requireConfigRole,
  asyncHandler(async (req, res) => {
    const schema = z.object({
      currencies: z.array(
        z.object({
          code: z.string().length(3).transform((v) => v.toUpperCase()),
          name: z.string().min(1).max(60),
          symbol: z.string().min(1).max(8),
          enabled: z.boolean(),
          sortOrder: z.number().int().min(0).max(1000),
        })
      ),
    });
    let body;
    try {
      body = schema.parse(req.body);
    } catch (e) {
      throw zodError(e);
    }
    for (const c of body.currencies) {
      await run(
        `INSERT INTO currencies (code, name, symbol, enabled, sort_order) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET name = excluded.name, symbol = excluded.symbol, enabled = excluded.enabled, sort_order = excluded.sort_order`,
        [c.code, c.name.trim(), c.symbol.trim(), c.enabled ? 1 : 0, c.sortOrder]
      );
    }
    await audit(req, { action: 'currencies_updated', entity: 'currencies', details: { count: body.currencies.length } });
    res.json({ ok: true });
  })
);

// -------------------------------------------------------- payment methods --

router.get(
  '/payment-methods',
  asyncHandler(async (_req, res) => {
    const rows = await all('SELECT * FROM payment_methods ORDER BY sort_order, code');
    res.json({
      methods: rows.map((r) => ({ ...r, enabled: !!r.enabled, config: parseJson(r.config, {}) })),
    });
  })
);

router.put(
  '/payment-methods',
  requireConfigRole,
  asyncHandler(async (req, res) => {
    const schema = z.object({
      methods: z.array(
        z.object({
          code: z.string().min(2).max(30),
          name: z.string().min(1).max(80).optional(),
          enabled: z.boolean(),
          sortOrder: z.number().int().min(0).max(1000),
        })
      ),
    });
    let body;
    try {
      body = schema.parse(req.body);
    } catch (e) {
      throw zodError(e);
    }
    for (const m of body.methods) {
      const existing = await get('SELECT * FROM payment_methods WHERE code = ?', [m.code]);
      if (!existing) throw notFound(`Unknown payment method "${m.code}".`);
      const config = parseJson(existing.config, {});
      await run(
        'UPDATE payment_methods SET name = ?, enabled = ?, sort_order = ?, config = ?, updated_at = ? WHERE code = ?',
        [m.name?.trim() || existing.name, m.enabled ? 1 : 0, m.sortOrder, JSON.stringify(config), isoNow(), m.code]
      );
      await audit(req, {
        action: m.enabled ? 'payment_method_enabled' : 'payment_method_disabled',
        entity: 'payment_method',
        entityId: m.code,
      });
    }
    res.json({ ok: true });
  })
);

/**
 * Card payment configuration. The client-facing label is fixed and the option
 * stays unavailable until a supported processor is actually integrated.
 */
router.put(
  '/card-config',
  requireConfigRole,
  asyncHandler(async (req, res) => {
    const schema = z.object({
      enabled: z.boolean(),
      processorName: z.string().max(80).optional().or(z.literal('')),
      regionVerified: z.boolean().optional().default(false),
    });
    let body;
    try {
      body = schema.parse(req.body);
    } catch (e) {
      throw zodError(e);
    }
    if (body.enabled && (!body.processorName || !body.processorName.trim())) {
      throw badRequest('Enabling card payments requires a supported payment processor to be configured first.');
    }
    if (body.enabled && !body.regionVerified) {
      throw badRequest('Enabling card payments requires regional eligibility to be verified.');
    }
    const row = await get('SELECT * FROM payment_methods WHERE code = ?', ['card']);
    if (!row) throw notFound('Card payment method is not registered.');
    const config = {
      label: CARD_LABEL,
      processorName: body.processorName?.trim() || null,
      regionVerified: !!body.regionVerified,
      // No processor integration exists in this version, so clients always see
      // the option as unavailable. This flag can only be set by a real
      // provider integration (hosted checkout), never from this form.
      processorIntegrated: false,
    };
    await run('UPDATE payment_methods SET enabled = ?, config = ?, updated_at = ? WHERE code = ?', [
      body.enabled ? 1 : 0,
      JSON.stringify(config),
      isoNow(),
      'card',
    ]);
    await audit(req, {
      action: 'card_config_updated',
      entity: 'payment_method',
      entityId: 'card',
      details: { enabled: body.enabled, processorName: config.processorName },
    });
    res.json({ ok: true, config });
  })
);

// -------------------------------------------------------- bank instructions

function serializeProfile(row) {
  return {
    id: row.id,
    currency: row.currency,
    profileName: row.profile_name,
    transferTypes: parseJson(row.transfer_types, []),
    fields: parseJson(row.fields, {}),
    enabled: !!row.enabled,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const profileSchema = z.object({
  currency: z.string().length(3).transform((v) => v.toUpperCase()),
  profileName: z.string().min(2, 'Profile name is required.').max(120),
  transferTypes: z.array(z.string()).default([]),
  fields: z.record(z.string(), z.string().max(2000)).default({}),
  enabled: z.boolean().optional().default(true),
  sortOrder: z.number().int().min(0).max(10000).optional().default(0),
});

async function validateProfile(body) {
  const currency = await get('SELECT * FROM currencies WHERE code = ?', [body.currency]);
  if (!currency) throw badRequest(`Unknown currency "${body.currency}".`);
  const allowedTypes = (TRANSFER_TYPES[body.currency] || []).map((t) => t.value);
  const invalid = body.transferTypes.filter((t) => !allowedTypes.includes(t));
  if (invalid.length) {
    throw badRequest(`Transfer type(s) not supported for ${body.currency}: ${invalid.join(', ')}`);
  }
  if (body.transferTypes.length === 0) {
    throw badRequest(`Select at least one supported transfer type for ${body.currency}.`);
  }
  const fieldErrors = validateInstructionFields(body.currency, body.fields);
  if (fieldErrors.length) {
    throw badRequest('Some instruction fields are invalid.', fieldErrors);
  }
  return currency;
}

router.get(
  '/bank-instructions',
  asyncHandler(async (req, res) => {
    const currency = req.query.currency ? String(req.query.currency).toUpperCase() : null;
    const rows = currency
      ? await all('SELECT * FROM bank_instructions WHERE currency = ? ORDER BY sort_order, id', [currency])
      : await all('SELECT * FROM bank_instructions ORDER BY currency, sort_order, id');
    res.json({ profiles: rows.map(serializeProfile) });
  })
);

router.post(
  '/bank-instructions',
  requireConfigRole,
  asyncHandler(async (req, res) => {
    let body;
    try {
      body = profileSchema.parse(req.body);
    } catch (e) {
      throw zodError(e);
    }
    await validateProfile(body);
    const now = isoNow();
    const inserted = await run(
      `INSERT INTO bank_instructions (currency, profile_name, transfer_types, fields, enabled, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        body.currency,
        body.profileName.trim(),
        JSON.stringify(body.transferTypes),
        JSON.stringify(body.fields),
        body.enabled ? 1 : 0,
        body.sortOrder,
        now,
        now,
      ]
    );
    await audit(req, {
      action: 'bank_instructions_created',
      entity: 'bank_instructions',
      entityId: inserted.lastInsertRowid,
      details: { currency: body.currency, profileName: body.profileName },
    });
    res.status(201).json({ profile: serializeProfile(await get('SELECT * FROM bank_instructions WHERE id = ?', [inserted.lastInsertRowid])) });
  })
);

router.put(
  '/bank-instructions/:id',
  requireConfigRole,
  asyncHandler(async (req, res) => {
    const row = await get('SELECT * FROM bank_instructions WHERE id = ?', [req.params.id]);
    if (!row) throw notFound('Bank instruction profile not found.');
    let body;
    try {
      body = profileSchema.parse({ ...req.body, currency: req.body.currency ?? row.currency });
    } catch (e) {
      throw zodError(e);
    }
    await validateProfile(body);
    await run(
      `UPDATE bank_instructions SET profile_name = ?, transfer_types = ?, fields = ?, enabled = ?, sort_order = ?, updated_at = ? WHERE id = ?`,
      [
        body.profileName.trim(),
        JSON.stringify(body.transferTypes),
        JSON.stringify(body.fields),
        body.enabled ? 1 : 0,
        body.sortOrder,
        isoNow(),
        row.id,
      ]
    );
    await audit(req, {
      action: 'bank_instructions_updated',
      entity: 'bank_instructions',
      entityId: row.id,
      details: { currency: body.currency, profileName: body.profileName },
    });
    res.json({ profile: serializeProfile(await get('SELECT * FROM bank_instructions WHERE id = ?', [row.id])) });
  })
);

router.post(
  '/bank-instructions/:id/enable',
  requireConfigRole,
  asyncHandler(async (req, res) => {
    const row = await get('SELECT * FROM bank_instructions WHERE id = ?', [req.params.id]);
    if (!row) throw notFound('Bank instruction profile not found.');
    await run('UPDATE bank_instructions SET enabled = ?, updated_at = ? WHERE id = ?', [req.body?.enabled === false ? 0 : 1, isoNow(), row.id]);
    await audit(req, {
      action: req.body?.enabled === false ? 'bank_instructions_disabled' : 'bank_instructions_enabled',
      entity: 'bank_instructions',
      entityId: row.id,
    });
    res.json({ profile: serializeProfile(await get('SELECT * FROM bank_instructions WHERE id = ?', [row.id])) });
  })
);

router.put(
  '/bank-instructions/reorder',
  requireConfigRole,
  asyncHandler(async (req, res) => {
    const schema = z.object({
      currency: z.string().length(3).transform((v) => v.toUpperCase()),
      orderedIds: z.array(z.number().int().positive()),
    });
    let body;
    try {
      body = schema.parse(req.body);
    } catch (e) {
      throw zodError(e);
    }
    // Same reason as above: `forEach(async ...)` never awaits the callback, so
    // the updates would still be in flight when the response was sent.
    let sortIndex = 0;
    for (const id of body.orderedIds) {
      await run('UPDATE bank_instructions SET sort_order = ?, updated_at = ? WHERE id = ? AND currency = ?', [
        sortIndex,
        isoNow(),
        id,
        body.currency,
      ]);
      sortIndex += 1;
    }
    await audit(req, { action: 'bank_instructions_reordered', entity: 'bank_instructions', details: { currency: body.currency } });
    res.json({ ok: true });
  })
);

/** Delete is blocked while the profile is referenced by payment references. */
router.delete(
  '/bank-instructions/:id',
  requireConfigRole,
  asyncHandler(async (req, res) => {
    const row = await get('SELECT * FROM bank_instructions WHERE id = ?', [req.params.id]);
    if (!row) throw notFound('Bank instruction profile not found.');
    const refs = (await get('SELECT COUNT(*) AS n FROM payment_references WHERE bank_profile_id = ?', [row.id])).n;
    if (refs > 0) {
      throw conflict(
        `This profile is referenced by ${refs} issued payment reference(s). Disable it instead — historical instructions must remain intact.`
      );
    }
    await run('DELETE FROM bank_instructions WHERE id = ?', [row.id]);
    await audit(req, {
      action: 'bank_instructions_deleted',
      entity: 'bank_instructions',
      entityId: row.id,
      details: { currency: row.currency, profileName: row.profile_name },
    });
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------- western union --

const wuSchema = z.object({
  displayName: z.string().min(2).max(80).optional(),
  currencies: z.array(z.string().length(3)).default([]),
  countries: z.array(z.string().min(2).max(80)).default([]),
  recipientName: z.string().max(200).optional().or(z.literal('')).nullable(),
  recipientLocation: z.string().max(200).optional().or(z.literal('')).nullable(),
  countryOfReceipt: z.string().max(120).optional().or(z.literal('')).nullable(),
  instructions: z.string().max(4000).optional().or(z.literal('')).nullable(),
  requiredSenderInfo: z.array(z.string()).default([]),
  requiredRecipientInfo: z.array(z.string()).default([]),
  mtcnRequired: z.boolean().optional().default(true),
  receiptRequired: z.boolean().optional().default(true),
  additionalNotes: z.string().max(4000).optional().or(z.literal('')).nullable(),
  clientInstructions: z.string().max(4000).optional().or(z.literal('')).nullable(),
  helpText: z.string().max(2000).optional().or(z.literal('')).nullable(),
  enabled: z.boolean().optional().default(false),
});

function serializeWU(row) {
  if (!row) {
    return {
      displayName: 'Western Union',
      currencies: [],
      countries: [],
      recipientName: null,
      recipientLocation: null,
      countryOfReceipt: null,
      instructions: null,
      requiredSenderInfo: [],
      requiredRecipientInfo: [],
      mtcnRequired: true,
      receiptRequired: true,
      additionalNotes: null,
      clientInstructions: null,
      helpText: null,
      enabled: false,
    };
  }
  return {
    displayName: row.display_name,
    currencies: parseJson(row.currencies, []),
    countries: parseJson(row.countries, []),
    recipientName: row.recipient_name,
    recipientLocation: row.recipient_location,
    countryOfReceipt: row.country_of_receipt,
    instructions: row.instructions,
    requiredSenderInfo: parseJson(row.required_sender_info, []),
    requiredRecipientInfo: parseJson(row.required_recipient_info, []),
    mtcnRequired: !!row.mtcn_required,
    receiptRequired: !!row.receipt_required,
    additionalNotes: row.additional_notes,
    clientInstructions: row.client_instructions,
    helpText: row.help_text,
    enabled: !!row.enabled,
    updatedAt: row.updated_at,
  };
}

router.get(
  '/western-union',
  asyncHandler(async (_req, res) => {
    res.json({ config: serializeWU(await get('SELECT * FROM western_union_config WHERE id = 1')) });
  })
);

router.put(
  '/western-union',
  requireConfigRole,
  asyncHandler(async (req, res) => {
    let body;
    try {
      body = wuSchema.parse(req.body);
    } catch (e) {
      throw zodError(e);
    }
    for (const code of body.currencies) {
      const c = await get('SELECT code FROM currencies WHERE code = ?', [code.toUpperCase()]);
      if (!c) throw badRequest(`Unknown currency "${code}".`);
    }
    const invalidSender = body.requiredSenderInfo.filter((v) => !WU_SENDER_INFO_OPTIONS.includes(v));
    const invalidRecipient = body.requiredRecipientInfo.filter((v) => !WU_RECIPIENT_INFO_OPTIONS.includes(v));
    if (invalidSender.length || invalidRecipient.length) {
      throw badRequest('Unknown required sender/recipient information options.');
    }
    if (body.enabled) {
      if (body.currencies.length === 0) {
        throw badRequest('Select at least one supported currency before enabling Western Union.');
      }
      if (!body.recipientName || !body.recipientName.trim()) {
        throw badRequest('Recipient name is required before enabling Western Union.');
      }
    }
    const now = isoNow();
    await run(
      `INSERT INTO western_union_config (id, display_name, currencies, countries, recipient_name, recipient_location,
         country_of_receipt, instructions, required_sender_info, required_recipient_info, mtcn_required,
         receipt_required, additional_notes, client_instructions, help_text, enabled, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         display_name = excluded.display_name, currencies = excluded.currencies, countries = excluded.countries,
         recipient_name = excluded.recipient_name, recipient_location = excluded.recipient_location,
         country_of_receipt = excluded.country_of_receipt, instructions = excluded.instructions,
         required_sender_info = excluded.required_sender_info, required_recipient_info = excluded.required_recipient_info,
         mtcn_required = excluded.mtcn_required, receipt_required = excluded.receipt_required,
         additional_notes = excluded.additional_notes, client_instructions = excluded.client_instructions,
         help_text = excluded.help_text, enabled = excluded.enabled, updated_at = excluded.updated_at`,
      [
        body.displayName?.trim() || 'Western Union',
        JSON.stringify(body.currencies.map((c) => c.toUpperCase())),
        JSON.stringify(body.countries.map((c) => c.trim()).filter(Boolean)),
        body.recipientName?.trim() || null,
        body.recipientLocation?.trim() || null,
        body.countryOfReceipt?.trim() || null,
        body.instructions?.trim() || null,
        JSON.stringify(body.requiredSenderInfo),
        JSON.stringify(body.requiredRecipientInfo),
        body.mtcnRequired ? 1 : 0,
        body.receiptRequired ? 1 : 0,
        body.additionalNotes?.trim() || null,
        body.clientInstructions?.trim() || null,
        body.helpText?.trim() || null,
        body.enabled ? 1 : 0,
        now,
      ]
    );
    await audit(req, {
      action: 'western_union_config_updated',
      entity: 'western_union_config',
      entityId: 1,
      details: { enabled: body.enabled, currencies: body.currencies },
    });
    res.json({ config: serializeWU(await get('SELECT * FROM western_union_config WHERE id = 1')) });
  })
);

export default router;
