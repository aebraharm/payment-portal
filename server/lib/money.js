/**
 * Money helpers. All amounts are stored as integer minor units (cents) with an
 * explicit currency code. Never use floating point for money.
 */

export function parseAmountToCents(input) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    input = String(input);
  }
  if (typeof input !== 'string') return null;
  const trimmed = input.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, frac = ''] = trimmed.split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(cents) || cents < 0) return null;
  return cents;
}

export function formatMoney(cents, currency, locale = 'en-US') {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency || 'USD',
      currencyDisplay: 'narrowSymbol',
    }).format((cents || 0) / 100);
  } catch {
    return `${(cents || 0) / 100} ${currency || ''}`.trim();
  }
}

export function formatAmountInput(cents) {
  return ((cents || 0) / 100).toFixed(2);
}
