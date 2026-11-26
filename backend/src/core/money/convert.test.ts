import { describe, expect, it } from 'vitest';
import { toUsdcUnits } from './convert';
import { cents } from './money';

describe('toUsdcUnits()', () => {
  it('converts euro cents to USDC base units exactly at 1 EUR = 1 USDC', () => {
    expect(toUsdcUnits(cents(58500))).toBe(585_000_000);
    expect(toUsdcUnits(cents(1))).toBe(10_000);
    expect(toUsdcUnits(cents(0))).toBe(0);
  });

  it('keeps every value an integer', () => {
    for (const value of [1, 99, 59999, 64800, 123_456_789]) {
      expect(Number.isSafeInteger(toUsdcUnits(cents(value)))).toBe(true);
    }
  });

  it('throws when the result would not be a safe integer', () => {
    expect(() => toUsdcUnits(cents(Number.MAX_SAFE_INTEGER))).toThrow(RangeError);
  });
});
