import { describe, expect, it } from 'vitest';
import { StoreId } from '@core/offers';
import { decimalEurosToCents, parseStoreMoney } from './parse-store-money';
import { StoreError } from './store-client';

describe('parseStoreMoney', () => {
  it.each([
    [StoreId.A, 58_500],
    [StoreId.B, '585.00'],
    [StoreId.C, '€585,00'],
    [StoreId.D, { amount: 58_500, currency: 'EUR' }],
    [StoreId.E, 'EUR 585.00'],
  ])('reads store %s format as 58500 cents', (storeId, raw) => {
    expect(parseStoreMoney(storeId, raw)).toBe(58_500);
  });

  it('keeps the cents exactly', () => {
    expect(decimalEurosToCents('599,99')).toBe(59_999);
    expect(decimalEurosToCents('0.05')).toBe(5);
  });

  it.each(['585', '585.5', '585.000', '5,85.00', '-1.00', '1e3.00', ''])(
    'refuses "%s": a price has exactly two decimals',
    (text) => {
      expect(() => decimalEurosToCents(text)).toThrow(StoreError);
    },
  );

  it('refuses another store format, a float and a wrong currency', () => {
    expect(() => parseStoreMoney(StoreId.B, 585)).toThrow(StoreError);
    expect(() => parseStoreMoney(StoreId.C, '585.00')).toThrow(StoreError);
    expect(() => parseStoreMoney(StoreId.A, 585.5)).toThrow(StoreError);
    expect(() => parseStoreMoney(StoreId.D, { amount: 58_500, currency: 'USD' })).toThrow(
      StoreError,
    );
    expect(() => parseStoreMoney(StoreId.E, '€585.00')).toThrow(StoreError);
  });
});
