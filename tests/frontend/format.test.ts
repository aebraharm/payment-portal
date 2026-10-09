import { describe, it, expect } from 'vitest';
import { formatMoney, formatDate, formatDateTime, todayIsoDate } from '../../src/lib/format';

describe('formatMoney', () => {
  it('formats integer cents with the correct currency symbol', () => {
    expect(formatMoney(250000, 'USD')).toBe('$2,500.00');
    expect(formatMoney(0, 'USD')).toBe('$0.00');
    expect(formatMoney(5, 'USD')).toBe('$0.05');
    expect(formatMoney(123456789, 'NGN')).toContain('1,234,567.89');
  });

  it('handles currencies without a well-known symbol via ISO code', () => {
    const out = formatMoney(100000, 'XYZ');
    expect(out).toContain('XYZ');
    expect(out).toContain('1,000.00');
  });
});

describe('formatDate / formatDateTime', () => {
  it('formats ISO timestamps as readable dates', () => {
    expect(formatDate('2026-10-09')).toBe('9 Oct 2026');
    expect(formatDateTime('2026-10-09T14:30:00.000Z')).toContain('2026');
  });

  it('returns an em dash for empty input', () => {
    expect(formatDate('')).toBe('—');
    expect(formatDateTime('')).toBe('—');
  });
});

describe('todayIsoDate', () => {
  it('returns a YYYY-MM-DD string', () => {
    expect(todayIsoDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
