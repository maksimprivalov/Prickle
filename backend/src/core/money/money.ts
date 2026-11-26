import { z } from 'zod';

// Money is never a float. Both units are non-negative safe integers, branded so a price in
// euro cents cannot be passed where USDC base units are expected, or the other way round.

/** Euro cents: €585.00 is 58500. */
export const Cents = z.int().nonnegative().brand<'Cents'>();
export type Cents = z.infer<typeof Cents>;

/** Test USDC base units, 6 decimals: 585 USDC is 585_000_000. */
export const UsdcUnits = z.int().nonnegative().brand<'UsdcUnits'>();
export type UsdcUnits = z.infer<typeof UsdcUnits>;

export type Money = Cents | UsdcUnits;

function assertMoneyValue(value: number, unit: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${unit} must be a non-negative safe integer, got ${value}`);
  }
}

export function cents(value: number): Cents {
  assertMoneyValue(value, 'Cents');
  return value as Cents;
}

export function usdcUnits(value: number): UsdcUnits {
  assertMoneyValue(value, 'UsdcUnits');
  return value as UsdcUnits;
}

// NoInfer makes both arguments take the unit of the first one, so add(cents, usdc) fails to
// compile instead of widening to Money.
export function add<T extends Money>(a: T, b: NoInfer<T>): T {
  const result = a + b;
  assertMoneyValue(result, 'Money sum');
  return result as T;
}

/** Throws when the result would be negative: money never goes below zero silently. */
export function sub<T extends Money>(a: T, b: NoInfer<T>): T {
  const result = a - b;
  assertMoneyValue(result, 'Money difference');
  return result as T;
}

export function sum<T extends Money>(values: readonly T[], zero: T): T {
  return values.reduce<T>((total, value) => add(total, value), zero);
}

export function lte<T extends Money>(a: T, b: NoInfer<T>): boolean {
  return a <= b;
}

export function lt<T extends Money>(a: T, b: NoInfer<T>): boolean {
  return a < b;
}
