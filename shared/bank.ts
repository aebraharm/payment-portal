// Currency-specific bank instruction definitions and validators.
// Each currency has its own transfer types and field set. A field is only applicable
// to the transfer types listed in `appliesTo`, and is only required for those in `requiredFor`.
// Validators are deliberately permissive where bank formats legitimately vary.

import type { Currency } from './constants';

export type TransferType =
  | 'ach'
  | 'domestic_wire'
  | 'international_wire'
  | 'domestic_eft'
  | 'sepa'
  | 'domestic_bacs';

export interface TransferTypeDef {
  value: TransferType;
  label: string;
  description: string;
}

export const TRANSFER_TYPES: Record<Currency, TransferTypeDef[]> = {
  USD: [
    { value: 'ach', label: 'Domestic ACH (United States)', description: 'ACH credit to a US bank account.' },
    { value: 'domestic_wire', label: 'Domestic wire (United States)', description: 'Wire to a US bank account.' },
    { value: 'international_wire', label: 'International wire (SWIFT)', description: 'Wire sent from outside the United States.' },
  ],
  CAD: [
    { value: 'domestic_eft', label: 'Domestic EFT (Canada)', description: 'Electronic funds transfer to a Canadian account.' },
    { value: 'international_wire', label: 'International wire (SWIFT)', description: 'Wire sent from outside Canada.' },
  ],
  EUR: [
    { value: 'sepa', label: 'SEPA credit transfer', description: 'Euro transfer from an account inside the SEPA area.' },
    { value: 'international_wire', label: 'International wire (SWIFT)', description: 'Euro wire sent from outside the SEPA area.' },
  ],
  GBP: [
    { value: 'domestic_bacs', label: 'UK domestic transfer', description: 'Sort code and account number from a UK bank.' },
    { value: 'international_wire', label: 'International wire (SWIFT)', description: 'Wire sent from outside the United Kingdom.' },
  ],
};

export type FieldKind =
  | 'text'
  | 'multiline'
  | 'aba'
  | 'transit'
  | 'institution'
  | 'sort_code'
  | 'iban'
  | 'bic'
  | 'account';

export interface BankFieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  help?: string;
  appliesTo: readonly TransferType[];
  requiredFor: readonly TransferType[];
}

export interface BankFieldGroup {
  fields: readonly string[];
  appliesTo: readonly TransferType[];
}

const ALL_USD: TransferType[] = ['ach', 'domestic_wire', 'international_wire'];
const ALL_CAD: TransferType[] = ['domestic_eft', 'international_wire'];
const ALL_EUR: TransferType[] = ['sepa', 'international_wire'];
const ALL_GBP: TransferType[] = ['domestic_bacs', 'international_wire'];

const common = (appliesTo: readonly TransferType[]): BankFieldDef[] => [
  {
    key: 'reference_instructions',
    label: 'Transfer reference instructions',
    kind: 'text',
    help: 'Optional guidance about the reference to quote. The portal always shows the generated payment reference.',
    appliesTo,
    requiredFor: [],
  },
  {
    key: 'additional_instructions',
    label: 'Additional instructions',
    kind: 'multiline',
    help: 'Optional. Shown to the client exactly as entered.',
    appliesTo,
    requiredFor: [],
  },
];

export const BANK_FIELDS: Record<Currency, BankFieldDef[]> = {
  USD: [
    {
      key: 'beneficiary_name',
      label: 'Beneficiary (account holder) name',
      kind: 'text',
      appliesTo: ALL_USD,
      requiredFor: ALL_USD,
    },
    { key: 'bank_name', label: 'Bank name', kind: 'text', appliesTo: ALL_USD, requiredFor: ALL_USD },
    { key: 'account_number', label: 'Account number', kind: 'account', appliesTo: ALL_USD, requiredFor: ALL_USD },
    {
      key: 'account_type',
      label: 'Account type',
      kind: 'text',
      help: 'For example checking or savings.',
      appliesTo: ['ach'],
      requiredFor: [],
    },
    {
      key: 'routing_number',
      label: 'Routing number (ABA)',
      kind: 'aba',
      appliesTo: ['ach', 'domestic_wire'],
      requiredFor: ['ach', 'domestic_wire'],
    },
    {
      key: 'ach_instructions',
      label: 'ACH instructions',
      kind: 'multiline',
      appliesTo: ['ach'],
      requiredFor: [],
    },
    {
      key: 'bank_address',
      label: 'Bank address',
      kind: 'multiline',
      appliesTo: ['domestic_wire', 'international_wire'],
      requiredFor: ['international_wire'],
    },
    {
      key: 'swift_bic',
      label: 'SWIFT/BIC',
      kind: 'bic',
      appliesTo: ['international_wire'],
      requiredFor: ['international_wire'],
    },
    {
      key: 'iban',
      label: 'IBAN',
      kind: 'iban',
      help: 'Only if the receiving bank uses an IBAN for this account.',
      appliesTo: ['international_wire'],
      requiredFor: [],
    },
    {
      key: 'intermediary_bank',
      label: 'Intermediary (correspondent) bank',
      kind: 'multiline',
      help: 'Only if the transfer has to pass through another bank.',
      appliesTo: ['international_wire'],
      requiredFor: [],
    },
    ...common(ALL_USD),
  ],
  CAD: [
    {
      key: 'beneficiary_name',
      label: 'Beneficiary name',
      kind: 'text',
      appliesTo: ALL_CAD,
      requiredFor: ALL_CAD,
    },
    {
      key: 'financial_institution',
      label: 'Financial institution name',
      kind: 'text',
      appliesTo: ALL_CAD,
      requiredFor: ALL_CAD,
    },
    { key: 'account_number', label: 'Account number', kind: 'account', appliesTo: ALL_CAD, requiredFor: ALL_CAD },
    {
      key: 'transit_number',
      label: 'Transit number (5 digits)',
      kind: 'transit',
      appliesTo: ['domestic_eft'],
      requiredFor: ['domestic_eft'],
    },
    {
      key: 'institution_number',
      label: 'Institution number (3 digits)',
      kind: 'institution',
      appliesTo: ['domestic_eft'],
      requiredFor: ['domestic_eft'],
    },
    {
      key: 'swift_bic',
      label: 'SWIFT/BIC',
      kind: 'bic',
      appliesTo: ['international_wire'],
      requiredFor: ['international_wire'],
    },
    {
      key: 'iban',
      label: 'IBAN',
      kind: 'iban',
      help: 'Only if the receiving bank uses an IBAN for this route.',
      appliesTo: ['international_wire'],
      requiredFor: [],
    },
    {
      key: 'bank_address',
      label: 'Bank address',
      kind: 'multiline',
      appliesTo: ['international_wire'],
      requiredFor: ['international_wire'],
    },
    {
      key: 'intermediary_bank',
      label: 'Intermediary bank',
      kind: 'multiline',
      appliesTo: ['international_wire'],
      requiredFor: [],
    },
    ...common(ALL_CAD),
  ],
  EUR: [
    {
      key: 'beneficiary_name',
      label: 'Beneficiary name',
      kind: 'text',
      appliesTo: ALL_EUR,
      requiredFor: ALL_EUR,
    },
    { key: 'bank_name', label: 'Bank name', kind: 'text', appliesTo: ALL_EUR, requiredFor: ALL_EUR },
    {
      key: 'iban',
      label: 'IBAN',
      kind: 'iban',
      appliesTo: ALL_EUR,
      requiredFor: ['sepa'],
    },
    {
      key: 'account_number',
      label: 'Account number',
      kind: 'account',
      help: 'Only needed for international wires when no IBAN is used.',
      appliesTo: ['international_wire'],
      requiredFor: [],
    },
    {
      key: 'bic',
      label: 'BIC/SWIFT',
      kind: 'bic',
      appliesTo: ALL_EUR,
      requiredFor: ['international_wire'],
    },
    {
      key: 'bank_address',
      label: 'Bank address',
      kind: 'multiline',
      appliesTo: ['international_wire'],
      requiredFor: ['international_wire'],
    },
    {
      key: 'intermediary_bank',
      label: 'Intermediary bank',
      kind: 'multiline',
      appliesTo: ['international_wire'],
      requiredFor: [],
    },
    ...common(ALL_EUR),
  ],
  GBP: [
    {
      key: 'beneficiary_name',
      label: 'Beneficiary name',
      kind: 'text',
      appliesTo: ALL_GBP,
      requiredFor: ALL_GBP,
    },
    { key: 'bank_name', label: 'Bank name', kind: 'text', appliesTo: ALL_GBP, requiredFor: ALL_GBP },
    {
      key: 'sort_code',
      label: 'Sort code',
      kind: 'sort_code',
      appliesTo: ['domestic_bacs'],
      requiredFor: ['domestic_bacs'],
    },
    {
      key: 'account_number',
      label: 'Account number',
      kind: 'account',
      help: 'UK account numbers are usually 8 digits. For international wires, use the IBAN or this account number.',
      appliesTo: ALL_GBP,
      requiredFor: ['domestic_bacs'],
    },
    {
      key: 'iban',
      label: 'IBAN',
      kind: 'iban',
      appliesTo: ['international_wire'],
      requiredFor: [],
    },
    {
      key: 'bic',
      label: 'BIC/SWIFT',
      kind: 'bic',
      appliesTo: ['international_wire'],
      requiredFor: ['international_wire'],
    },
    {
      key: 'bank_address',
      label: 'Bank address',
      kind: 'multiline',
      appliesTo: ['international_wire'],
      requiredFor: ['international_wire'],
    },
    {
      key: 'intermediary_bank',
      label: 'Intermediary bank',
      kind: 'multiline',
      appliesTo: ['international_wire'],
      requiredFor: [],
    },
    ...common(ALL_GBP),
  ],
};

/** Groups where at least one listed field must be supplied for the given transfer types. */
export const BANK_FIELD_GROUPS: Partial<Record<Currency, BankFieldGroup[]>> = {
  EUR: [{ fields: ['iban', 'account_number'], appliesTo: ['international_wire'] }],
  GBP: [{ fields: ['iban', 'account_number'], appliesTo: ['international_wire'] }],
};

/** Field keys whose change must be explicitly confirmed by an administrator and are masked in audit logs. */
export const SENSITIVE_BANK_KEYS: readonly string[] = [
  'beneficiary_name',
  'account_number',
  'routing_number',
  'iban',
  'swift_bic',
  'bic',
  'sort_code',
  'transit_number',
  'institution_number',
];

export function transferTypesFor(currency: Currency): TransferTypeDef[] {
  return TRANSFER_TYPES[currency];
}

export function transferTypeLabel(currency: Currency, value: string): string | undefined {
  return TRANSFER_TYPES[currency].find((type) => type.value === value)?.label;
}

export function fieldsFor(currency: Currency, transferType: string): BankFieldDef[] {
  return BANK_FIELDS[currency].filter((field) => field.appliesTo.includes(transferType as TransferType));
}

export function fieldLabel(currency: Currency, key: string): string {
  return BANK_FIELDS[currency].find((field) => field.key === key)?.label ?? key;
}

export interface BankValidationResult {
  valid: boolean;
  values: Record<string, string>;
  errors: Record<string, string>;
}

/** Validates and normalises the fields for one currency and transfer type. Unknown or inapplicable keys are dropped. */
export function validateBankFields(
  currency: Currency,
  transferType: string,
  input: Record<string, unknown>,
): BankValidationResult {
  const errors: Record<string, string> = {};
  const values: Record<string, string> = {};
  const allowed = TRANSFER_TYPES[currency].map((type) => type.value as string);
  if (!allowed.includes(transferType)) {
    errors.transfer_type = 'Choose a transfer type that this currency supports.';
    return { valid: false, values, errors };
  }
  const type = transferType as TransferType;

  for (const field of fieldsFor(currency, type)) {
    const raw = input[field.key] == null ? '' : String(input[field.key]);
    const result = normalizeField(field.kind, raw);
    if (result.error) {
      errors[field.key] = result.error;
      continue;
    }
    if (!result.value) {
      if (field.requiredFor.includes(type)) errors[field.key] = 'Required for this transfer type.';
      continue;
    }
    values[field.key] = result.value;
  }

  for (const group of BANK_FIELD_GROUPS[currency] ?? []) {
    if (!group.appliesTo.includes(type)) continue;
    if (!group.fields.some((key) => values[key])) {
      const message = `Enter ${group.fields.map((key) => fieldLabel(currency, key)).join(' or ')}.`;
      for (const key of group.fields) errors[key] ??= message;
    }
  }

  return { valid: Object.keys(errors).length === 0, values, errors };
}

interface NormalizeResult {
  value?: string;
  error?: string;
}

function limited(raw: string, max: number): NormalizeResult {
  const value = raw.trim();
  if (value.length > max) return { error: `Use at most ${max} characters.` };
  return { value };
}

export function normalizeField(kind: FieldKind, raw: string): NormalizeResult {
  switch (kind) {
    case 'text':
      return limited(raw, 200);
    case 'multiline':
      return limited(raw, 2000);
    case 'aba': {
      const value = raw.replace(/[\s-]/g, '');
      if (value === '') return {};
      if (!/^\d{9}$/.test(value)) return { error: 'Enter the 9-digit routing number.' };
      if (!abaChecksumValid(value)) return { error: 'This routing number fails the ABA check digit. Confirm it with the bank.' };
      return { value };
    }
    case 'transit': {
      const value = raw.replace(/\s/g, '');
      if (value === '') return {};
      if (!/^\d{5}$/.test(value)) return { error: 'Enter the 5-digit transit number.' };
      return { value };
    }
    case 'institution': {
      const value = raw.replace(/\s/g, '');
      if (value === '') return {};
      if (!/^\d{3}$/.test(value)) return { error: 'Enter the 3-digit institution number.' };
      return { value };
    }
    case 'sort_code': {
      const value = raw.replace(/\s/g, '');
      if (value === '') return {};
      const match = /^(\d{2})-?(\d{2})-?(\d{2})$/.exec(value);
      if (!match) return { error: 'Enter the 6-digit sort code, for example 12-34-56.' };
      return { value: `${match[1]}-${match[2]}-${match[3]}` };
    }
    case 'iban': {
      const value = raw.replace(/\s/g, '').toUpperCase();
      if (value === '') return {};
      if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(value)) return { error: 'Enter a valid IBAN, for example GB82WEST12345698765432.' };
      if (!ibanChecksumValid(value)) return { error: 'This IBAN fails the checksum. Check it for typing errors.' };
      return { value };
    }
    case 'bic': {
      const value = raw.replace(/\s/g, '').toUpperCase();
      if (value === '') return {};
      if (!/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(value)) return { error: 'Enter an 8 or 11 character BIC/SWIFT code.' };
      return { value };
    }
    case 'account': {
      const value = raw.replace(/\s/g, '');
      if (value === '') return {};
      if (!/^[A-Za-z0-9][A-Za-z0-9\-/]{1,33}$/.test(value)) {
        return { error: 'Enter 2 to 34 letters or digits (dashes and slashes allowed).' };
      }
      return { value };
    }
    default:
      return { error: 'Unsupported field.' };
  }
}

export function abaChecksumValid(routing: string): boolean {
  if (!/^\d{9}$/.test(routing)) return false;
  const d = routing.split('').map(Number);
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8]);
  return sum % 10 === 0;
}

/** ISO 13616 mod-97 check. Spaces and case are ignored; the country and check digits must be well formed. */
export function ibanChecksumValid(input: string): boolean {
  const iban = input.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    if (char >= '0' && char <= '9') {
      remainder = (remainder * 10 + Number(char)) % 97;
    } else {
      const value = char.charCodeAt(0) - 55; // A=10 ... Z=35
      remainder = (remainder * 100 + value) % 97;
    }
  }
  return remainder === 1;
}
