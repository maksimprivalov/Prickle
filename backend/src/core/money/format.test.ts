import { describe, expect, it } from 'vitest';
import { formatEur, formatUsdc } from './format';
import { cents, usdcUnits } from './money';

describe('formatEur()', () => {
  it.each([
    [58500, '€585.00'],
    [64805, '€648.05'],
    [7, '€0.07'],
    [0, '€0.00'],
  ])('formats %i cents as %s', (value, expected) => {
    expect(formatEur(cents(value))).toBe(expected);
  });
});

describe('formatUsdc()', () => {
  it.each([
    [585_000_000, '585.00 USDC'],
    [10_000, '0.01 USDC'],
    [1, '0.000001 USDC'],
    [0, '0.00 USDC'],
  ])('formats %i base units as %s', (value, expected) => {
    expect(formatUsdc(usdcUnits(value))).toBe(expected);
  });
});
