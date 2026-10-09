// Decimal-safe money helpers. Amounts are carried as canonical decimal strings
// with two places (for example "1250.00") and arithmetic is done on BigInt minor units.
// Floating point is never used for money arithmetic.

const USER_AMOUNT_PATTERN = /^(0|[1-9]\d{0,11})(\.\d{1,2})?$/;
const SIGNED_DECIMAL = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;

/** Parses user input such as "1,250.5" into a canonical "1250.50", or returns null if invalid. */
export function parseAmountInput(raw: string): string | null {
  const cleaned = String(raw ?? '')
    .trim()
    .replace(/[,\s]/g, '');
  if (!USER_AMOUNT_PATTERN.test(cleaned)) return null;
  const [whole, fraction = ''] = cleaned.split('.');
  return `${whole}.${fraction.padEnd(2, '0')}`;
}

export function isPositiveAmount(raw: string): boolean {
  const parsed = parseAmountInput(raw);
  return parsed !== null && toMinor(parsed) > 0n;
}

/** Converts a canonical decimal string into integer minor units (cents). */
export function toMinor(amount: string): bigint {
  const match = SIGNED_DECIMAL.exec(amount.trim());
  if (!match) throw new Error(`Invalid decimal amount: ${amount}`);
  const minor = BigInt(match[2]) * 100n + BigInt((match[3] ?? '0').padEnd(2, '0'));
  return match[1] ? -minor : minor;
}

export function fromMinor(minor: bigint): string {
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const text = `${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
  return negative ? `-${text}` : text;
}

export function sumAmounts(values: readonly string[]): string {
  return fromMinor(values.reduce((total, value) => total + toMinor(value), 0n));
}

export function subtractAmounts(a: string, b: string): string {
  return fromMinor(toMinor(a) - toMinor(b));
}

export function compareAmounts(a: string, b: string): -1 | 0 | 1 {
  const difference = toMinor(a) - toMinor(b);
  if (difference > 0n) return 1;
  if (difference < 0n) return -1;
  return 0;
}

/** Display-only formatting, for example "USD 1,250.00". Never used for arithmetic. */
export function formatMoney(amount: string, currency: string): string {
  const formatted = new Intl.NumberFormat('en', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount));
  return `${currency} ${formatted}`;
}
