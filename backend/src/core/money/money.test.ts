import { describe, expect, it } from 'vitest';
import { Cents, add, cents, lt, lte, sub, sum, usdcUnits } from './money';

describe('cents()', () => {
  it('accepts zero and whole cents', () => {
    expect(cents(0)).toBe(0);
    expect(cents(58500)).toBe(58500);
  });

  it.each([0.5, 599.99, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'throws on %s',
    (value) => {
      expect(() => cents(value)).toThrow(RangeError);
    },
  );
});

describe('usdcUnits()', () => {
  it('throws on a fraction and on an unsafe integer', () => {
    expect(() => usdcUnits(1.5)).toThrow(RangeError);
    expect(() => usdcUnits(2 ** 53)).toThrow(RangeError);
  });
});

describe('the Cents schema', () => {
  it('parses an integer and rejects a float, as a store payload would send it', () => {
    expect(Cents.safeParse(64800).success).toBe(true);
    expect(Cents.safeParse(648.0001).success).toBe(false);
    expect(Cents.safeParse(-100).success).toBe(false);
  });
});

describe('arithmetic', () => {
  it('adds and subtracts exactly', () => {
    expect(add(cents(59900), cents(4900))).toBe(64800);
    expect(sub(cents(60000), cents(58500))).toBe(1500);
  });

  it('throws instead of going below zero', () => {
    expect(() => sub(cents(58500), cents(60000))).toThrow(RangeError);
  });

  it('throws when a sum leaves the safe integer range', () => {
    expect(() => add(usdcUnits(Number.MAX_SAFE_INTEGER), usdcUnits(1))).toThrow(RangeError);
  });

  it('sums a list, starting from the given zero', () => {
    expect(sum([cents(100), cents(250), cents(1)], cents(0))).toBe(351);
    expect(sum([], cents(0))).toBe(0);
  });

  it('compares at the exact boundary', () => {
    expect(lte(cents(60000), cents(60000))).toBe(true);
    expect(lte(cents(60001), cents(60000))).toBe(false);
    expect(lt(cents(60000), cents(60000))).toBe(false);
  });

  it('does not mix units at compile time', () => {
    // @ts-expect-error Cents and UsdcUnits cannot be added together.
    add(cents(1), usdcUnits(1));
  });
});
