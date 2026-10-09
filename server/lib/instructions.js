import { get, all, parseJson } from '../db.js';
import { getSetting, getPaymentMethod } from './settings.js';
import { CARD_LABEL } from './paymentConfig.js';

/**
 * Build the instruction snapshot shown to a client when a payment reference is
 * issued. The snapshot is stored with the payment reference so later
 * configuration changes never alter historical transaction records.
 */
export function buildBankTransferSnapshot(currency) {
  const profile = get(
    'SELECT * FROM bank_instructions WHERE currency = ? AND enabled = 1 ORDER BY sort_order, id LIMIT 1',
    [currency]
  );
  if (!profile) return null;
  const fields = parseJson(profile.fields, {});
  const nonEmptyFields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v !== null && v !== undefined && String(v).trim() !== '') nonEmptyFields[k] = String(v).trim();
  }
  return {
    type: 'bank_transfer',
    currency,
    profile: {
      id: profile.id,
      name: profile.profile_name,
      transferTypes: parseJson(profile.transfer_types, []),
      fields: nonEmptyFields,
    },
    generalInstructions: getSetting('payment_instructions') || '',
    disclaimer: getSetting('payment_disclaimer') || '',
  };
}

export function buildWesternUnionSnapshot() {
  const row = get('SELECT * FROM western_union_config WHERE id = 1');
  if (!row || !row.enabled) return null;
  return {
    type: 'western_union',
    displayName: row.display_name,
    recipientName: row.recipient_name,
    recipientLocation: row.recipient_location,
    countryOfReceipt: row.country_of_receipt,
    countries: parseJson(row.countries, []),
    currencies: parseJson(row.currencies, []),
    instructions: row.instructions || '',
    clientInstructions: row.client_instructions || '',
    requiredSenderInfo: parseJson(row.required_sender_info, []),
    requiredRecipientInfo: parseJson(row.required_recipient_info, []),
    mtcnRequired: !!row.mtcn_required,
    receiptRequired: !!row.receipt_required,
    additionalNotes: row.additional_notes || '',
    helpText: row.help_text || '',
    generalInstructions: getSetting('payment_instructions') || '',
    disclaimer: getSetting('payment_disclaimer') || '',
  };
}

/**
 * Compute which payment methods are selectable for a given invoice currency.
 * The card option is always reported as unavailable in this version.
 */
export function getAvailableMethodsForCurrency(currency) {
  const methods = all('SELECT * FROM payment_methods WHERE enabled = 1 ORDER BY sort_order, code');
  const out = [];
  for (const m of methods) {
    if (m.code === 'card') {
      out.push({
        code: 'card',
        name: m.name,
        available: false,
        label: CARD_LABEL,
        reason: 'Card payments are not available in your region.',
      });
      continue;
    }
    if (m.code === 'bank_transfer') {
      const profileCount = get(
        'SELECT COUNT(*) AS n FROM bank_instructions WHERE currency = ? AND enabled = 1',
        [currency]
      ).n;
      out.push({
        code: 'bank_transfer',
        name: m.name,
        available: profileCount > 0,
        ...(profileCount === 0
          ? { reason: `Bank transfer instructions for ${currency} have not been configured yet. Please contact support.` }
          : {}),
      });
      continue;
    }
    if (m.code === 'western_union') {
      const wu = get('SELECT * FROM western_union_config WHERE id = 1');
      const currencies = wu ? parseJson(wu.currencies, []) : [];
      const supported = !!wu && !!wu.enabled && currencies.includes(currency);
      out.push({
        code: 'western_union',
        name: (wu && wu.display_name) || m.name,
        available: supported,
        ...(supported ? {} : { reason: `Western Union transfers are not configured for ${currency}.` }),
      });
      continue;
    }
    out.push({ code: m.code, name: m.name, available: true });
  }
  // Always surface the (disabled) card option so clients see the label.
  if (!out.some((m) => m.code === 'card')) {
    const card = getPaymentMethod('card');
    out.push({
      code: 'card',
      name: card?.name || 'Card Payment',
      available: false,
      label: CARD_LABEL,
      reason: 'Card payments are not available in your region.',
    });
  }
  return out;
}
