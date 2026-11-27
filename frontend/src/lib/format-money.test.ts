import { describe, expect, it } from 'vitest';
import { formatCents, formatMoney, formatUsdc } from './format-money';

describe('formatCents', () => {
  it('formats integer cents with two decimals', () => {
    expect(formatCents(58500)).toBe('585.00');
    expect(formatCents(5)).toBe('0.05');
    expect(formatCents(0)).toBe('0.00');
    expect(formatCents(123456789)).toBe('1,234,567.89');
  });

  it('refuses a float or a negative amount', () => {
    expect(() => formatCents(585.5)).toThrow(RangeError);
    expect(() => formatCents(-1)).toThrow(RangeError);
  });
});

describe('formatUsdc', () => {
  it('formats base units with up to six decimals, at least two when there is a fraction', () => {
    expect(formatUsdc(585_000_000)).toBe('585');
    expect(formatUsdc(585_500_000)).toBe('585.50');
    expect(formatUsdc(1)).toBe('0.000001');
  });
});

describe('formatMoney', () => {
  it('labels the unit', () => {
    expect(formatMoney(60000, 'EUR')).toBe('600.00 EUR');
    expect(formatMoney(600_000_000, 'USDC')).toBe('600 test USDC');
  });
});
