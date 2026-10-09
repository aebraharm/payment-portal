/**
 * Currency-specific payment configuration schema. Shared by the admin API and
 * exposed to the frontend so the UI never hardcodes banking fields.
 */

export const CURRENCY_FIELDS = {
  USD: [
    { key: 'beneficiary_name', label: 'Beneficiary / account-holder name', required: true },
    { key: 'bank_name', label: 'Bank name', required: true },
    { key: 'account_number', label: 'Account number', required: true },
    { key: 'account_type', label: 'Account type (e.g. Checking / Savings)' },
    { key: 'routing_number', label: 'Routing number (ABA)', pattern: '^\\d{9}$', patternHint: '9 digits' },
    { key: 'ach_instructions', label: 'ACH instructions', multiline: true },
    { key: 'domestic_wire_instructions', label: 'Domestic wire instructions', multiline: true },
    { key: 'swift_bic', label: 'SWIFT / BIC', pattern: '^[A-Za-z]{6}[A-Za-z0-9]{2}([A-Za-z0-9]{3})?$', patternHint: '8 or 11 characters' },
    { key: 'iban', label: 'IBAN (where applicable)', pattern: '^[A-Za-z]{2}\\d{2}[A-Za-z0-9]{10,30}$' },
    { key: 'bank_address', label: 'Bank address', multiline: true },
    { key: 'intermediary_bank', label: 'Intermediary / correspondent bank (if applicable)', multiline: true },
    { key: 'required_reference', label: 'Required transfer reference' },
    { key: 'additional_instructions', label: 'Additional instructions', multiline: true },
  ],
  CAD: [
    { key: 'beneficiary_name', label: 'Beneficiary name', required: true },
    { key: 'bank_name', label: 'Financial institution name', required: true },
    { key: 'account_number', label: 'Account number', required: true },
    { key: 'transit_number', label: 'Transit number', pattern: '^\\d{5}$', patternHint: '5 digits' },
    { key: 'institution_number', label: 'Institution number', pattern: '^\\d{3}$', patternHint: '3 digits' },
    { key: 'swift_bic', label: 'SWIFT / BIC (international transfers)', pattern: '^[A-Za-z]{6}[A-Za-z0-9]{2}([A-Za-z0-9]{3})?$' },
    { key: 'iban', label: 'IBAN (if the route uses it)' },
    { key: 'bank_address', label: 'Bank address' },
    { key: 'intermediary_bank', label: 'Intermediary bank (international transfers)', multiline: true },
    { key: 'required_reference', label: 'Required payment reference' },
    { key: 'additional_instructions', label: 'Additional instructions', multiline: true },
  ],
  EUR: [
    { key: 'beneficiary_name', label: 'Beneficiary name', required: true },
    { key: 'bank_name', label: 'Bank name', required: true },
    { key: 'iban', label: 'IBAN', required: true, pattern: '^[A-Za-z]{2}\\d{2}[A-Za-z0-9]{10,30}$' },
    { key: 'bic_swift', label: 'BIC / SWIFT', required: true, pattern: '^[A-Za-z]{6}[A-Za-z0-9]{2}([A-Za-z0-9]{3})?$' },
    { key: 'bank_address', label: 'Bank address' },
    { key: 'sepa_available', label: 'SEPA transfer availability', multiline: true },
    { key: 'international_wire_available', label: 'International wire availability', multiline: true },
    { key: 'intermediary_bank', label: 'Intermediary bank (if required)', multiline: true },
    { key: 'required_reference', label: 'Required transfer reference' },
    { key: 'additional_instructions', label: 'Additional instructions', multiline: true },
  ],
  GBP: [
    { key: 'beneficiary_name', label: 'Beneficiary name', required: true },
    { key: 'bank_name', label: 'Bank name', required: true },
    { key: 'account_number', label: 'Account number', required: true, pattern: '^\\d{8}$', patternHint: '8 digits' },
    { key: 'sort_code', label: 'Sort code', required: true, pattern: '^\\d{2}-?\\d{2}-?\\d{2}$', patternHint: '6 digits, e.g. 12-34-56' },
    { key: 'iban', label: 'IBAN (international transfers, where applicable)' },
    { key: 'bic_swift', label: 'BIC / SWIFT (international transfers)', pattern: '^[A-Za-z]{6}[A-Za-z0-9]{2}([A-Za-z0-9]{3})?$' },
    { key: 'bank_address', label: 'Bank address' },
    { key: 'domestic_transfer_instructions', label: 'Domestic UK transfer instructions (FPS/BACS)', multiline: true },
    { key: 'international_wire_instructions', label: 'International wire instructions', multiline: true },
    { key: 'intermediary_bank', label: 'Intermediary bank (if required)', multiline: true },
    { key: 'required_reference', label: 'Required transfer reference' },
    { key: 'additional_instructions', label: 'Additional instructions', multiline: true },
  ],
};

export const TRANSFER_TYPES = {
  USD: [
    { value: 'ach', label: 'ACH transfer' },
    { value: 'domestic_wire', label: 'Domestic wire (US)' },
    { value: 'international_wire', label: 'International wire' },
  ],
  CAD: [
    { value: 'domestic_transfer', label: 'Domestic Canadian transfer' },
    { value: 'interac_etransfer', label: 'Interac e-Transfer' },
    { value: 'international_wire', label: 'International wire' },
  ],
  EUR: [
    { value: 'sepa_transfer', label: 'SEPA transfer (EUR zone)' },
    { value: 'international_wire', label: 'International wire (SWIFT)' },
  ],
  GBP: [
    { value: 'domestic_transfer', label: 'Domestic UK bank transfer (FPS/BACS)' },
    { value: 'international_wire', label: 'International wire (SWIFT)' },
  ],
};

export const WU_SENDER_INFO_OPTIONS = [
  'sender_full_name',
  'sender_address',
  'sender_phone',
  'sender_id_document',
];

export const WU_RECIPIENT_INFO_OPTIONS = [
  'recipient_full_name',
  'recipient_phone',
  'recipient_address',
];

export const CARD_LABEL = 'Not available in your region';

/** Validate optional field formats where practical (never reject legitimate formats). */
export function validateInstructionFields(currency, fields) {
  const errors = [];
  const defs = CURRENCY_FIELDS[currency] || [];
  for (const def of defs) {
    const value = fields[def.key];
    if (value === undefined || value === null || String(value).trim() === '') {
      if (def.required) errors.push(`${def.label} is required for ${currency} instructions.`);
      continue;
    }
    if (def.pattern) {
      const re = new RegExp(def.pattern);
      if (!re.test(String(value).trim())) {
        errors.push(`${def.label} is not in a valid format${def.patternHint ? ` (${def.patternHint})` : ''}.`);
      }
    }
  }
  return errors;
}
